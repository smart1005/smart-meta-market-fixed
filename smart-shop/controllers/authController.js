const axios = require("axios");
const logger = require("../utils/logger");
const { db, admin } = require("../config/firebase");
const { buildLocationData } = require("../utils/LocationLookup");

// Maps common Firebase Admin SDK error codes to friendly, safe messages.
// Returns null for anything unrecognized so the caller falls back to a
// fully generic message instead of ever leaking a raw error/network detail.
const mapFirebaseAdminErrorCode = (error) => {
  switch (error.code) {
    case "auth/email-already-exists":
      return "An account with this email already exists.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/invalid-password":
      return "Password must be at least 6 characters.";
    case "auth/phone-number-already-exists":
      return "An account with this phone number already exists.";
    default:
      return null;
  }
};

/**
 * Creates a Firebase Auth user, then runs writeFirestoreDocs(userRecord)
 * to write whatever Firestore doc(s) that account needs. If the Firestore
 * write fails for ANY reason, the just-created Auth user is deleted so the
 * whole operation fails cleanly — instead of leaving an orphaned Auth
 * account with no Firestore profile, which login() can't handle either
 * (it 404s with "User profile not found") and which blocks retrying with
 * the same email (Firebase Auth still reports it as taken).
 */
const createUserAtomically = async (authPayload, writeFirestoreDocs) =>
  withEmailLock(authPayload.email, async () => {
    const userRecord = await admin.auth().createUser(authPayload);

    try {
      await writeFirestoreDocs(userRecord);
      return userRecord;
    } catch (firestoreError) {
      logger.error(
        { err: firestoreError, uid: userRecord.uid },
        "Firestore write failed after Auth user created — rolling back Auth user",
      );

      try {
        await admin.auth().deleteUser(userRecord.uid);
      } catch (rollbackError) {
        logger.error(
          { err: rollbackError, uid: userRecord.uid },
          "CRITICAL: failed to roll back orphaned Auth user — manual cleanup needed in Firebase Console",
        );
      }

      throw firestoreError;
    }
  });

const register = async (req, res) => {
  try {
    const { email, password, name, phone, address } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    const userRecord = await createUserAtomically(
      { email, password, displayName: name },
      async (record) => {
        await db.collection("users").doc(record.uid).set({
          name,
          email,
          phone,
          address,
          role: "customer",
          createdAt: new Date(),
        });
      },
    );

    try {
      const apiKey = process.env.FIREBASE_API_KEY;

      if (!apiKey) {
        logger.error(
          "Missing FIREBASE_API_KEY for register verification email.",
        );
      } else {
        const signInRes = await axios.post(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
          { email, password, returnSecureToken: true },
        );

        await axios.post(
          `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
          { requestType: "VERIFY_EMAIL", idToken: signInRes.data.idToken },
        );
      }
    } catch (verificationError) {
      logger.error(
        { err: verificationError.response?.data || verificationError.message },
        "Account created but verification email failed to send",
      );
    }

    res.status(201).json({
      message:
        "Account created successfully. Please check your email to verify your account before logging in.",
      userId: userRecord.uid,
    });
  } catch (error) {
    if (error.code === "REGISTRATION_IN_PROGRESS") {
      return res.status(409).json({
        message:
          "This email is already being registered. Please wait a moment and try again.",
      });
    }

    logger.error({ err: error }, "Error creating account");

    const friendly = mapFirebaseAdminErrorCode(error);

    res.status(friendly ? 400 : 500).json({
      message:
        friendly ||
        "Something went wrong creating your account. Please try again.",
    });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    const apiKey = process.env.FIREBASE_API_KEY;

    if (!apiKey) {
      logger.error("Missing FIREBASE_API_KEY for login.");

      return res.status(500).json({
        message: "Something went wrong logging you in. Please try again.",
      });
    }

    const response = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        email,
        password,
        returnSecureToken: true,
      },
    );

    const token = response.data.idToken;
    const uid = response.data.localId;

    const firebaseUser = await admin.auth().getUser(uid);

    if (!firebaseUser.emailVerified) {
      return res.status(403).json({
        message:
          "Please verify your email before logging in. Check your inbox.",
        emailNotVerified: true,
      });
    }

    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        message: "User profile not found.",
      });
    }

    const userData = userDoc.data();

    return res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: uid,
        email,
        name: userData.name,
        role: userData.role,
        emailVerified: firebaseUser.emailVerified,
      },
    });
  } catch (error) {
    logger.error(
      { err: error.response?.data || error.message },
      "Error logging in",
    );

    const firebaseCode = error.response?.data?.error?.message;

    if (firebaseCode === "TOO_MANY_ATTEMPTS_TRY_LATER") {
      return res.status(429).json({
        message: "Too many attempts. Please wait a few minutes and try again.",
      });
    }

    if (firebaseCode) {
      return res.status(401).json({
        message: "Invalid email or password.",
      });
    }

    res.status(500).json({
      message: "Something went wrong logging you in. Please try again.",
    });
  }
};

const createAdmin = async (req, res) => {
  try {
    const { email, password, name, phone, role } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    const allowedRoles = ["admin", "superAdmin"];
    const assignedRole = allowedRoles.includes(role) ? role : "admin";

    const userRecord = await createUserAtomically(
      { email, password, displayName: name },
      async (record) => {
        await db.collection("users").doc(record.uid).set({
          name,
          email,
          phone,
          role: assignedRole,
          createdAt: new Date(),
        });
      },
    );

    res.status(201).json({
      message: `${assignedRole} account created successfully`,
      userId: userRecord.uid,
    });
  } catch (error) {
    if (error.code === "REGISTRATION_IN_PROGRESS") {
      return res.status(409).json({
        message:
          "This email is already being registered. Please wait a moment and try again.",
      });
    }

    logger.error({ err: error }, "Error creating admin");

    const friendly = mapFirebaseAdminErrorCode(error);

    res.status(friendly ? 400 : 500).json({
      message:
        friendly ||
        "Something went wrong creating that account. Please try again.",
    });
  }
};

const registerVendor = async (req, res) => {
  try {
    const {
      email,
      password,
      name,
      phone,
      businessName,
      vendorType,
      state,
      lga,
    } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    if (!businessName) {
      return res.status(400).json({
        message: "Business name is required.",
      });
    }

    if (!vendorType || !["product", "service"].includes(vendorType)) {
      return res.status(400).json({
        message: "vendorType must be 'product' or 'service'.",
      });
    }

    if (!state || !lga) {
      return res.status(400).json({
        message: "State and LGA are required.",
      });
    }

    const locationData = buildLocationData(state, lga);

    if (!locationData) {
      return res.status(400).json({
        message:
          "Invalid state/LGA combination. Please select from the provided list.",
      });
    }

    const expiryDate = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    );

    const nowTimestamp = admin.firestore.Timestamp.fromDate(new Date());

    const userRecord = await createUserAtomically(
      { email, password, displayName: businessName },
      async (record) => {
        await db.collection("users").doc(record.uid).set({
          name,
          email,
          phone,
          role: "vendor",
          createdAt: nowTimestamp,
        });

        await db
          .collection("vendorProfiles")
          .doc(record.uid)
          .set({
            businessName,
            vendorType,
            location: locationData,
            subscriptionStatus: "active",
            subscriptionExpiry:
              admin.firestore.Timestamp.fromDate(expiryDate),
            createdAt: nowTimestamp,
          });
      },
    );

    try {
      const apiKey = process.env.FIREBASE_API_KEY;

      if (!apiKey) {
        logger.error("Missing FIREBASE_API_KEY for registerVendor.");

        return res.status(201).json({
          message:
            "Vendor account created successfully, but we couldn't send a verification email. Please contact support to verify your account.",
          vendorId: userRecord.uid,
        });
      }

      const signInRes = await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
        {
          email,
          password,
          returnSecureToken: true,
        },
      );

      await axios.post(
        `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
        {
          requestType: "VERIFY_EMAIL",
          idToken: signInRes.data.idToken,
        },
      );

      return res.status(201).json({
        message:
          "Vendor account created successfully. Please check your email to verify your account before logging in.",
        vendorId: userRecord.uid,
      });
    } catch (verificationError) {
      logger.error(
        {
          err:
            verificationError.response?.data ||
            verificationError.message,
        },
        "Vendor account created but verification email failed to send",
      );

      return res.status(201).json({
        message:
          "Vendor account created successfully, but we couldn't send a verification email. Please contact support to verify your account.",
        vendorId: userRecord.uid,
      });
    }
  } catch (error) {
    if (error.code === "REGISTRATION_IN_PROGRESS") {
      return res.status(409).json({
        message:
          "This email is already being registered. Please wait a moment and try again.",
      });
    }

    logger.error({ err: error }, "Error creating vendor account");

    const friendly = mapFirebaseAdminErrorCode(error);

    res.status(friendly ? 400 : 500).json({
      message:
        friendly ||
        "Something went wrong creating your vendor account. Please try again.",
    });
  }
};

const createSuperAdmin = async (req, res) => {
  try {
    const { email, password, name, phone } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    const userRecord = await createUserAtomically(
      { email, password, displayName: name },
      async (record) => {
        await db.collection("users").doc(record.uid).set({
          name,
          email,
          phone,
          role: "superAdmin",
          createdAt: new Date(),
        });
      },
    );

    res.status(201).json({
      message: "SuperAdmin account created successfully",
      userId: userRecord.uid,
    });
  } catch (error) {
    if (error.code === "REGISTRATION_IN_PROGRESS") {
      return res.status(409).json({
        message:
          "This email is already being registered. Please wait a moment and try again.",
      });
    }

    logger.error({ err: error }, "Error creating superAdmin");

    const friendly = mapFirebaseAdminErrorCode(error);

    res.status(friendly ? 400 : 500).json({
      message:
        friendly ||
        "Something went wrong creating your account. Please try again.",
    });
  }
};

const forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      message: "Email is required",
    });
  }

  const apiKey = process.env.FIREBASE_API_KEY;

  if (!apiKey) {
    logger.error("Missing FIREBASE_API_KEY for forgotPassword.");

    return res.status(500).json({
      message: "Something went wrong. Please try again.",
    });
  }

  try {
    await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`,
      {
        requestType: "PASSWORD_RESET",
        email,
      },
    );

    return res.status(200).json({
      message:
        "If an account exists with that email, a password reset link has been sent.",
    });
  } catch (error) {
    logger.error(
      {
        err:
          error.response?.data ||
          error.message,
      },
      "Error sending password reset email",
    );

    return res.status(500).json({
      message:
        "Something went wrong sending the password reset link. Please try again.",
    });
  }
};

module.exports = {
  register,
  login,
  createAdmin,
  forgotPassword,
  registerVendor,
  createSuperAdmin,
};