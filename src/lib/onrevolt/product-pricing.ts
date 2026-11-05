type Numeric = string | number | { toString(): string };

export type ProductPurchasePrice = {
  purchaseNet: Numeric;
  currentPurchaseNet?: Numeric | null;
};

export function productPurchasePriceNeedsReview(price: ProductPurchasePrice): boolean {
  return Number(price.purchaseNet) > 0 && price.currentPurchaseNet != null && Number(price.currentPurchaseNet) === 0;
}

export function resolveProductPurchaseNet(price: ProductPurchasePrice): number {
  if (productPurchasePriceNeedsReview(price)) {
    throw new Error('Cena zakupu wymaga weryfikacji: poprzedni koszt jest dodatni, a aktualny wynosi 0 zł. Potwierdź cenę w katalogu.');
  }
  const value = Number(price.currentPurchaseNet ?? price.purchaseNet);
  if (!Number.isFinite(value) || value < 0) throw new Error('Nieprawidłowa cena zakupu netto.');
  return value;
}
