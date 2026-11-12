import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { StaffEnv } from '../middleware/auth.js'
import { ApiError } from '../middleware/error-handler.js'
import { body, collection, pagination } from '../validators/common.js'
import { areaSchema, parse, reviewSchema, uuidSchema } from '../validators/scans.js'
import { prepareImages, MAX_UPLOAD_BYTES } from '../services/images.service.js'
import type { ScansService } from '../services/scans.service.js'
export function scanRoutes(service: ScansService) {
  const router = new Hono<StaffEnv>()
  router.post('/', bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: () => { throw new ApiError(413, 'BODY_TOO_LARGE', 'Scan upload exceeds 26 MiB') } }), async c => {
    const key = parse(uuidSchema, c.req.header('Idempotency-Key'))
    if (!c.req.header('content-type')?.startsWith('multipart/form-data;')) throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use multipart/form-data with images and area')
    let form: FormData
    try { form = await c.req.raw.formData() } catch { throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid multipart form') }
    if ([...form.keys()].some(k => !['images', 'area'].includes(k)) || form.getAll('area').length !== 1) throw new ApiError(400, 'VALIDATION_ERROR', 'Provide images and exactly one area')
    const files = form.getAll('images')
    if (files.some(f => !(f instanceof File))) throw new ApiError(400, 'INVALID_IMAGES', 'images must contain files')
    const area = parse(areaSchema, form.get('area'))
    const scan = await service.create(c.get('staff').id, key, area, await prepareImages(files as File[]))
    c.header('Location', `/api/inventory/scans/${scan.id}`)
    return c.json({ data: scan }, scan.status === 'processing' ? 202 : 201)
  })
  router.get('/', async c => { const p = pagination(c); return c.json(collection(await service.list(p), p)) })
  router.get('/:scanId', async c => c.json({ data: await service.get(parse(uuidSchema, c.req.param('scanId'))) }))
  router.patch('/:scanId/items/:itemId', async c => c.json({ data: await service.review(parse(uuidSchema, c.req.param('scanId')), parse(uuidSchema, c.req.param('itemId')), parse(reviewSchema, await body(c))) }))
  router.post('/:scanId/approve', async c => c.json({ data: await service.approve(parse(uuidSchema, c.req.param('scanId')), c.get('staff').id) }))
  router.post('/:scanId/reject', async c => c.json({ data: await service.reject(parse(uuidSchema, c.req.param('scanId')), c.get('staff').id) }))
  return router
}
