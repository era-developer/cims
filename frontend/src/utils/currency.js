// Indian digit grouping (lakh/crore: 1,72,93,865.88) instead of the western
// thousands grouping Number.prototype.toFixed leaves you to add by hand.
const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatInr(value) {
  return `₹${INR_FORMATTER.format(Number(value) || 0)}`;
}
