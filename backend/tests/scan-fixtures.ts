import type { DetectedItem } from '../src/validators/scans.js'
export const label: NonNullable<DetectedItem['nutrition']> = {
  servingSize: '1 cup', calories: 140, totalFatGrams: 2, saturatedFatGrams: null, transFatGrams: null,
  cholesterolMilligrams: null, sodiumMilligrams: 190, totalCarbohydrateGrams: 29,
  dietaryFiberGrams: 4, totalSugarsGrams: 2, addedSugarsGrams: null, proteinGrams: 5,
  micronutrients: [{ name: 'Iron', value: 8, unit: 'mg' }], ingredients: null, allergens: [],
  source: 'product_label', confidence: .95,
}
export const detected: DetectedItem = {
  productName: 'Cheerios', brand: 'General Mills', category: 'Cereal', packageSize: '18 oz', variation: 'Original', barcode: null,
  quantity: 12, unit: 'boxes', quantityKind: 'visible_count', confidence: .95, quantityConfidence: .95,
  needsReview: false, warnings: [], expirationDate: null, nutrition: label,
}
export const modelResponse = (value: unknown) => ({
  id: 'resp_mock', object: 'response', status: 'completed',
  output: [{ type: 'message', id: 'msg_mock', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(value), annotations: [] }] }],
})
