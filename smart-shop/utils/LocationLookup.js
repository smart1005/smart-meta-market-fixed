const fs = require("fs");
const path = require("path");
const geofire = require("geofire-common");

const lgaData = JSON.parse(
  fs.readFileSync(path.join(__dirname, "nigeriaLGAs.json"), "utf8"),
);

// normalize for case/whitespace-insensitive matching
const normalize = (str) => (str || "").trim().toLowerCase();

// ── Get all distinct state names ──
const getStatesList = () => {
  const states = new Set(lgaData.map((entry) => entry.state_name));
  return Array.from(states).sort();
};

// ── Get all LGA names for a given state ──
const getLgasForState = (stateName) => {
  const target = normalize(stateName);
  return lgaData
    .filter((entry) => normalize(entry.state_name) === target)
    .map((entry) => entry.name)
    .sort();
};

// ── Find lat/lng for a given state + LGA ──
const findLgaCoordinates = (stateName, lgaName) => {
  const targetState = normalize(stateName);
  const targetLga = normalize(lgaName);

  const match = lgaData.find(
    (entry) =>
      normalize(entry.state_name) === targetState &&
      normalize(entry.name) === targetLga,
  );

  if (!match) return null;

  return {
    lat: match.latitude,
    lng: match.longitude,
  };
};

// ── Compute a geohash string for a lat/lng pair ──
const computeGeohash = (lat, lng) => geofire.geohashForLocation([lat, lng]);

// ── Build a full location object ready to save to Firestore ──
// Returns null if the state/LGA combination isn't found in the dataset
const buildLocationData = (stateName, lgaName) => {
  const coords = findLgaCoordinates(stateName, lgaName);
  if (!coords) return null;

  return {
    state: stateName,
    lga: lgaName,
    lat: coords.lat,
    lng: coords.lng,
    geohash: computeGeohash(coords.lat, coords.lng),
  };
};

module.exports = {
  getStatesList,
  getLgasForState,
  findLgaCoordinates,
  computeGeohash,
  buildLocationData,
};
