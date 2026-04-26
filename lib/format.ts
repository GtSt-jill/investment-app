export function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

export function formatPrice(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: "exceptZero"
  }).format(value);
}

export function formatNumber(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat("ja-JP", {
    maximumFractionDigits
  }).format(value);
}
