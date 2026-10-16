import { describe, expect, it, vi } from 'vitest'
import { http } from './http'
import { dropOffering, enrollOffering, getCourseDetail, getCourseOfferings, getCourses, getEnrollToken } from './courses'

/** 只校验请求参数的序列化，不发真实请求。 */
describe('courses service params', () => {
  it('sends list filters as query params and omits unset ones', async () => {
    const spy = vi.spyOn(http, 'get').mockResolvedValue({ data: {} } as never)
    await getCourses({ page: 2, page_size: 20, keyword: '数据', course_type: 'required' })
    expect(spy).toHaveBeenLastCalledWith('/courses', {
      params: { page: 2, page_size: 20, keyword: '数据', course_type: 'required' },
    })
    spy.mockRestore()
  })

  it('wraps a bare array response into the paged shape the page expects', async () => {
    const rows = [{ id: 101, course_code: 'CS1001', name: '程序设计基础' }]
    const spy = vi.spyOn(http, 'get').mockResolvedValue({ data: { code: 0, data: rows } } as never)
    const result = await getCourses({ page: 1, page_size: 20 })
    expect(result).toEqual({ items: rows, page: 1, page_size: 20, total: 1, has_more: false })
    spy.mockRestore()
  })

  it('normalizes null schedules and empty teacher objects in offerings', async () => {
    const offering = {
      id: 507,
      section_no: '01',
      teacher: { id: null, name: null },
      schedules: null,
      current_user: { enrollment_status: null, can_enroll: true, can_drop: false },
    }
    const spy = vi.spyOn(http, 'get').mockResolvedValue({ data: { code: 0, data: [offering] } } as never)
    const [result] = await getCourseOfferings(107, 2)
    expect(result.schedules).toEqual([])
    expect(result.teacher).toBeNull()
    spy.mockRestore()
  })

  it('flattens course detail returned under a wrapper key', async () => {
    const payload = {
      cursor: { id: 102, course_code: 'CS2001', name: '数据结构', credit: 4.0, total_hours: 64 },
      description: '线性表、栈、队列、树与图的基本结构及常用算法。',
      prerequisites: [{ id: 101, course_code: 'CS1001', name: '程序设计基础' }],
    }
    const spy = vi.spyOn(http, 'get').mockResolvedValue({ data: { code: 0, data: payload } } as never)
    const result = await getCourseDetail(102)
    expect(result.name).toBe('数据结构')
    expect(result.course_code).toBe('CS2001')
    expect(result.credit).toBe(4.0)
    expect(result.description).toBe('线性表、栈、队列、树与图的基本结构及常用算法。')
    expect(result.prerequisites).toHaveLength(1)
    spy.mockRestore()
  })

  it('maps term_id to the snake_case query for offerings', async () => {
    const spy = vi.spyOn(http, 'get').mockResolvedValue({ data: {} } as never)
    await getCourseOfferings(101, 2)
    expect(spy).toHaveBeenLastCalledWith('/courses/101/offerings', { params: { term_id: 2 } })
    spy.mockRestore()
  })
})

describe('course enrollment requests', () => {
  it('requests a token from the enroll-token endpoint', async () => {
    const spy = vi.spyOn(http, 'post').mockResolvedValue({ data: { code: 0, data: { token: 'tk-1' } } } as never)
    const token = await getEnrollToken(501)
    expect(spy).toHaveBeenCalledWith('/courses/offerings/501/enroll-token')
    expect(token).toBe('tk-1')
    spy.mockRestore()
  })

  it('sends the token in the Idempotency-Token header when enrolling', async () => {
    const spy = vi.spyOn(http, 'post').mockResolvedValue({ status: 202, data: null } as never)
    await enrollOffering(107, 501, '2026-2027-1', 'tk-1')
    expect(spy).toHaveBeenCalledWith(
      '/courses/107/offerings/501/enroll',
      undefined,
      { params: { term_code: '2026-2027-1' }, headers: { 'Idempotency-Token': 'tk-1' } },
    )
    spy.mockRestore()
  })

  it('calls DELETE on the enroll path when dropping', async () => {
    const spy = vi.spyOn(http, 'delete').mockResolvedValue({ data: { code: 0, data: {} } } as never)
    await dropOffering(107, 501, '2026-2027-1')
    expect(spy).toHaveBeenCalledWith('/courses/107/offerings/501/enroll', { params: { term_code: '2026-2027-1' } })
    spy.mockRestore()
  })
})
