const { getStatesList, getLgasForState } = require("../utils/LocationLookup");
const logger = require("../utils/logger");

const getStates = (req, res) => {
  try {
    const states = getStatesList();
    res.status(200).json({ states });
  } catch (error) {
    logger.error("Error fetching states:", error);
    res.status(500).json({
      message: "Unable to load states right now. Please try again.",
    });
  }
};

const getLgas = (req, res) => {
  try {
    const { state } = req.params;
    if (!state) {
      return res.status(400).json({ message: "State is required" });
    }
    const lgas = getLgasForState(state);
    if (lgas.length === 0) {
      return res.status(404).json({ message: "No LGAs found for that state" });
    }
    res.status(200).json({ lgas });
  } catch (error) {
    logger.error("Error fetching LGAs:", error);
    res.status(500).json({
      message: "Unable to load LGAs right now. Please try again.",
    });
  }
};

module.exports = {
  getStates,
  getLgas,
};
