import { Hono } from 'hono'
import type { ProductsService } from '../services/products.service.js'
import { body, collection, id, pagination } from '../validators/common.js'
import { productInput } from '../validators/products.js'

export function productRoutes(service: ProductsService) {
  const router = new Hono()
  router.get('/', async (c) => {
    const p = pagination(c)
    return c.json(collection(await service.list(p), p))
  })
  router.get('/:id', async (c) => c.json({ data: await service.get(id(c.req.param('id'))) }))
  router.post('/', async (c) => {
    const input = productInput(await body(c))
    const row = await service.create({ ...input, name: input.name!, categoryId: input.categoryId! })
    c.header('Location', `/api/products/${row.id}`)
    return c.json({ data: row }, 201)
  })
  router.patch('/:id', async (c) => {
    const recordId = id(c.req.param('id'))
    return c.json({ data: await service.update(recordId, productInput(await body(c), true)) })
  })
  return router
}
