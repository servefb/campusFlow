/** 课程模块接口类型，口径见后端接口文档第 20 章。 */

export type CourseType = 'required' | 'elective' | 'public' | 'practice'

export type SelectionStatus = 'not_open' | 'open' | 'closed'

export type EnrollmentStatus = 'selected' | 'dropped' | 'completed'

export interface CourseTerm {
  id: number
  code: string
  name: string
  start_date: string
  end_date: string
  is_current: boolean
}

export interface CourseOrganization {
  id: number
  name: string
}

export interface CourseListItem {
  id: number
  course_code: string
  name: string
  english_name: string | null
  course_type: CourseType
  credit: number
  total_hours: number
  organization: CourseOrganization | null
}

export interface CoursePrerequisite {
  id: number
  course_code: string
  name: string
}

export interface CourseDetail extends CourseListItem {
  description: string | null
  prerequisites: CoursePrerequisite[]
}

export interface CourseSchedule {
  weekday: number
  start_period: number
  end_period: number
  week_range: string
  location: string | null
}

export interface CourseOfferingCurrentUser {
  enrollment_status: EnrollmentStatus | null
  can_enroll: boolean
  can_drop: boolean
}

export interface CourseOffering {
  id: number
  course: { id: number; course_code: string; name: string; credit: number }
  term: { id: number; code: string; name: string }
  section_no: string
  teacher: { id: number; name: string } | null
  campus: string | null
  capacity: number
  enrolled_count: number
  remaining: number
  selection_status: SelectionStatus
  selection_start_at: string | null
  selection_end_at: string | null
  schedules: CourseSchedule[]
  current_user: CourseOfferingCurrentUser
}

export interface PagedData<T> {
  items: T[]
  page: number
  page_size: number
  total: number
  has_more: boolean
}

export interface CourseEnrollment {
  enrollment_id: number
  enrollment_status: EnrollmentStatus
  selected_at: string
  final_grade: string | null
  offering: CourseOffering
}

/** `GET /courses/my` 的单项：学生为选课记录，教师为任教开课班（直接是 offering，不含 enrollment_*）。 */
export type MyCourseItem = Partial<CourseEnrollment> & { offering?: CourseOffering } & Partial<CourseOffering>

export interface EnrollResult {
  offering_id: number
  enrollment_status: EnrollmentStatus
  enrolled_count: number
  remaining: number
}

/** 选课 / 退课失败时 `details[0].reason` 的取值（文档 20.10 / 20.11）。 */
export type CourseActionReason =
  | 'selection_not_open'
  | 'capacity_full'
  | 'already_selected'
  | 'schedule_conflict'
  | 'prerequisite_not_met'
  | 'not_enrolled'
  | 'token_invalid'
