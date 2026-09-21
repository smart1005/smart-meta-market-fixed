require("dotenv").config();
const { db } = require("../config/firebase");

const check = async () => {
  try {
    const snapshot = await db.collection("vendorProfiles").get();

    if (snapshot.empty) {
      console.log("No vendorProfiles docs found at all.");
      process.exit(0);
    }

    console.log(`Found ${snapshot.size} vendor profile(s):\n`);

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const expiry = data.subscriptionExpiry?.toDate
        ? data.subscriptionExpiry.toDate().toISOString()
        : data.subscriptionExpiry || "none";

      console.log(
        `- ${doc.id} | ${data.businessName || "(no business name)"} | status: ${data.subscriptionStatus || "(none)"} | expires: ${expiry}`,
      );
    });

    process.exit(0);
  } catch (error) {
    console.error("Check failed:", error.message);
    process.exit(1);
  }
};

check();
