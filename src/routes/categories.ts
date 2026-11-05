import { Hono } from 'hono'
import type { CategoriesService } from '../services/categories.service.js'
import { body, collection, id, pagination } from '../validators/common.js'
import { categoryInput } from '../validators/categories.js'

export function categoryRoutes(service: CategoriesService) {
  const router = new Hono()
  router.get('/', async (c) => {
    const p = pagination(c)
    return c.json(collection(await service.list(p), p))
  })
  router.get('/:id', async (c) => c.json({ data: await service.get(id(c.req.param('id'))) }))
  router.post('/', async (c) => {
    const input = categoryInput(await body(c))
    const row = await service.create({ ...input, name: input.name! })
    c.header('Location', `/api/categories/${row.id}`)
    return c.json({ data: row }, 201)
  })
  router.patch('/:id', async (c) => {
    const recordId = id(c.req.param('id'))
    return c.json({ data: await service.update(recordId, categoryInput(await body(c), true)) })
  })
  return router
}
