import { http } from './http'
import type { ApiSuccess } from '../types/api'
import type {
  CourseDetail,
  CourseListItem,
  CourseOffering,
  CourseTerm,
  MyCourseItem,
  CourseType,
  EnrollResult,
  PagedData,
} from '../types/courses'

/**
 * 课程接口的 `data` 有两种形态：分页对象 `{ items, page, ... }`，或直接是数组（目前列表接口即如此）。
 * 这里统一成 `PagedData`，页面只面对一种结构，避免 `data.items` 为 undefined 时渲染崩溃。
 */
const toPaged = <T>(payload: unknown, page: number, pageSize: number): PagedData<T> => {
  if (Array.isArray(payload)) {
    return { items: payload as T[], page, page_size: pageSize, total: payload.length, has_more: false }
  }
  const paged = (payload ?? {}) as Partial<PagedData<T>>
  const items = Array.isArray(paged.items) ? paged.items : []
  return {
    items,
    page: paged.page ?? page,
    page_size: paged.page_size ?? pageSize,
    total: paged.total ?? items.length,
    has_more: paged.has_more ?? false,
  }
}

export const getCourseTerms = async (params?: { current_only?: boolean }): Promise<CourseTerm[]> => {
  const { data } = await http.get<ApiSuccess<CourseTerm[] | { items: CourseTerm[] }>>('/courses/terms', { params })
  const payload = data.data
  return Array.isArray(payload) ? payload : (payload?.items ?? [])
}

export const getCourses = async (params: {
  page?: number
  page_size?: number
  keyword?: string
  course_type?: CourseType
  organization_id?: number
  sort?: boolean
}): Promise<PagedData<CourseListItem>> => {
  const { data } = await http.get<ApiSuccess<CourseListItem[] | PagedData<CourseListItem>>>('/courses', { params })
  return toPaged<CourseListItem>(data.data, params.page ?? 1, params.page_size ?? 20)
}

/**
 * 课程详情的 `data` 目前有两种形态：扁平（文档 20.6），或课程字段包在一个对象里
 * （当前后端返回 `cursor`，文档约定的键名是 `course`）。这里统一拍平成 `CourseDetail`。
 */
type CourseDetailPayload = Partial<CourseDetail> & {
  course?: Partial<CourseListItem>
  cursor?: Partial<CourseListItem>
}

const toCourseDetail = (payload: CourseDetailPayload): CourseDetail => {
  const { course, cursor, ...rest } = payload
  const base = course ?? cursor ?? {}
  return {
    ...(base as CourseListItem),
    ...(rest as Partial<CourseDetail>),
    description: payload.description ?? null,
    prerequisites: payload.prerequisites ?? [],
  } as CourseDetail
}

export const getCourseDetail = async (courseId: number): Promise<CourseDetail> => {
  const { data } = await http.get<ApiSuccess<CourseDetailPayload>>(`/courses/${courseId}`)
  return toCourseDetail(data.data ?? {})
}

/**
 * 开课班的可空字段兜底：后端对"未排课 / 未指定教师"可能返回 `null` 或空对象，
 * 页面统一按"空数组 / null"处理，避免对 `null` 取属性导致整页崩溃。
 */
const normalizeOffering = (offering: CourseOffering): CourseOffering => ({
  ...offering,
  schedules: offering.schedules ?? [],
  teacher: offering.teacher?.id != null || offering.teacher?.name ? offering.teacher : null,
})

export const getCourseOfferings = async (courseId: number, termId: number): Promise<CourseOffering[]> => {
  const { data } = await http.get<ApiSuccess<CourseOffering[] | { items: CourseOffering[] }>>(
    `/courses/${courseId}/offerings`,
    { params: { term_id: termId } },
  )
  const payload = data.data
  const items = Array.isArray(payload) ? payload : (payload?.items ?? [])
  return items.map(normalizeOffering)
}

/** 开课班详情（文档 20.8）：单个开课班，字段与 20.7 列表项一致，含当前用户的选课状态。 */
export const getCourseOfferingDetail = async (offeringId: number): Promise<CourseOffering> => {
  const { data } = await http.get<ApiSuccess<CourseOffering>>(`/courses/offerings/${offeringId}`)
  return normalizeOffering(data.data)
}

/** 我的课表（文档 20.9）。学生返回选课记录，教师返回任教开课班。 */
export const getMyCourses = async (params: {
  term_id?: number
  include_dropped?: boolean
  page?: number
  page_size?: number
}): Promise<PagedData<MyCourseItem>> => {
  const { data } = await http.get<ApiSuccess<MyCourseItem[] | PagedData<MyCourseItem>>>('/courses/my', { params })
  return toPaged<MyCourseItem>(data.data, params.page ?? 1, params.page_size ?? 20)
}

/**
 * 取选课 token（文档 20.10）。token 由服务端存入 Redis，TTL 约 60 秒，单次有效。
 * 每次用户点击「选课」都重新申请一个，不要复用上一次的 token。
 */
export const getEnrollToken = async (offeringId: number): Promise<string> => {
  const { data } = await http.post<ApiSuccess<{ token: string }>>(`/courses/offerings/${offeringId}/enroll-token`)
  return data.data.token
}

/**
 * 选课（文档 20.10）。必须携带 `Idempotency-Token` 与学期 `term_code`。
 * 服务端异步入库：成功只代表受理（HTTP 202，无响应体），结果需通过 `getCourseOfferingDetail` 轮询。
 * 超时后可以用同一个 token 重试：服务端返回第一次的受理结果，不会重复入队。
 */
export const enrollOffering = async (
  courseId: number,
  offeringId: number,
  termCode: string,
  token: string,
): Promise<void> => {
  await http.post(
    `/courses/${courseId}/offerings/${offeringId}/enroll`,
    undefined,
    { params: { term_code: termCode }, headers: { 'Idempotency-Token': token } },
  )
}

/** 退课（文档 20.11）。路径与选课一致，需带 `course_id` 与学期 `term_code`。 */
export const dropOffering = async (
  courseId: number,
  offeringId: number,
  termCode: string,
): Promise<EnrollResult> => {
  const { data } = await http.delete<ApiSuccess<EnrollResult>>(
    `/courses/${courseId}/offerings/${offeringId}/enroll`,
    { params: { term_code: termCode } },
  )
  return data.data
}
