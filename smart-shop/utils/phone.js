// Turns any Nigerian mobile format into 234XXXXXXXXXX (13 digits).
// Returns null when the number is not a valid Nigerian mobile.
const normalizeNgPhone = (raw) => {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");

  if (digits.startsWith("234")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);

  if (!/^[789]\d{9}$/.test(digits)) return null;
  return `234${digits}`;
};

module.exports = { normalizeNgPhone };
