import type { Nutrition } from '../db/schema.js'
import { object, keys, string, integer, invalid } from './common.js'

function nutrition(value: unknown): Nutrition {
  const input = object(value)
  keys(input, ['servingSize', 'calories', 'totalFatGrams', 'sodiumMilligrams', 'totalCarbohydrateGrams', 'proteinGrams'])
  const result: Nutrition = {}
  for (const field of ['calories', 'totalFatGrams', 'sodiumMilligrams', 'totalCarbohydrateGrams', 'proteinGrams'] as const) {
    if (field in input) {
      const value = input[field]
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000000) invalid(`${field} must be a finite number between 0 and 1000000`)
      result[field] = value
    }
  }
  if ('servingSize' in input) result.servingSize = string(input.servingSize, 'servingSize', 100)
  return result
}

export type ProductInput = { name?: string; brand?: string | null; barcode?: string | null; description?: string | null; packageSize?: string | null; variation?: string | null; categoryId?: number; nutrition?: Nutrition | null }
export function productInput(value: unknown, patch = false): ProductInput {
  const input = object(value)
  keys(input, ['name', 'brand', 'barcode', 'description', 'categoryId', 'nutrition', 'packageSize', 'variation'])
  const result: ProductInput = {}
  if ('name' in input) result.name = string(input.name, 'name', 200)
  for (const [field, max] of [['brand', 200], ['barcode', 100], ['description', 4000], ['packageSize', 100], ['variation', 200]] as const) {
    if (field in input) result[field] = input[field] === null ? null : string(input[field], field, max)
  }
  if ('categoryId' in input) result.categoryId = integer(input.categoryId, 'categoryId', 1)
  if ('nutrition' in input) result.nutrition = input.nutrition === null ? null : nutrition(input.nutrition)
  if (!patch && (!result.name || !result.categoryId)) invalid('name and categoryId are required')
  if (patch && !Object.keys(result).length) invalid('Provide at least one field to update')
  return result
}
