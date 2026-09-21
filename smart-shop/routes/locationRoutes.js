const express = require("express");
const router = express.Router();
const asyncHandler = require("../middleware/asyncHandler");
const { getStates, getLgas } = require("../controllers/locationController");

router.get("/states", asyncHandler(getStates));
router.get("/states/:state/lgas", asyncHandler(getLgas));

module.exports = router;
