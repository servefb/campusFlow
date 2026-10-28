import { useEffect, useState } from 'react'
import axios from 'axios'
import { BookOpen, CircleAlert, Clock3, MapPin, Search, Users } from 'lucide-react'
import { apiErrorMessage } from '../services/http'
import {
  dropOffering,
  enrollOffering,
  getEnrollToken,
  getCourseDetail,
  getCourseOfferingDetail,
  getCourseOfferings,
  getCourses,
  getCourseTerms,
  getMyCourses,
} from '../services/courses'
import { useAuthStore } from '../stores/auth'
import type {
  CourseActionReason,
  CourseDetail,
  CourseListItem,
  CourseOffering,
  CourseTerm,
  CourseType,
  MyCourseItem,
  PagedData,
} from '../types/courses'

const PAGE_SIZE = 20

const courseTypeLabels: Record<CourseType, string> = {
  required: '必修',
  elective: '选修',
  public: '公共',
  practice: '实践',
}

const selectionLabels: Record<CourseOffering['selection_status'], string> = {
  not_open: '未开放选课',
  open: '选课中',
  closed: '选课已结束',
}

const enrollmentLabels: Record<'selected' | 'dropped' | 'completed', string> = {
  selected: '已选',
  dropped: '已退课',
  completed: '已修完',
}

/** 文档 20.10 / 20.11 的 `reason` → 用户可读提示。 */
const actionReasonLabels: Record<CourseActionReason, string> = {
  selection_not_open: '当前不在选课窗口内',
  capacity_full: '该教学班已满员',
  already_selected: '你已选过该教学班',
  schedule_conflict: '与已选课程上课时间冲突',
  prerequisite_not_met: '尚未修过先修课程',
  not_enrolled: '你没有选过该教学班',
  token_invalid: '操作已过期，请重新点击选课',
}

const weekdayLabels = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

const formatSchedule = (item: CourseOffering['schedules'][number]) =>
  `${weekdayLabels[item.weekday]} 第${item.start_period}–${item.end_period}节 · ${item.week_range}周`

/**
 * 选课：每次点击申请一个新 token（文档 20.10）。
 * 只有「没有收到任何响应」（超时、断网）才用同一个 token 重试一次；服务端会返回第一次的结果。
 * 重试仍失败时，以服务端的选课状态为准：已是「已选」就视为成功，避免把实际成功的选课显示成失败。
 */
const enrollWithToken = async (courseId: number, offeringId: number, termCode: string) => {
  const token = await getEnrollToken(offeringId)
  try {
    return await enrollOffering(courseId, offeringId, termCode, token)
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response) throw error
    try {
      return await enrollOffering(courseId, offeringId, termCode, token)
    } catch (retryError) {
      const fresh = await getCourseOfferingDetail(offeringId)
      if (fresh.current_user.enrollment_status === 'selected') return null
      throw retryError
    }
  }
}

const ENROLL_POLL_ATTEMPTS = 10
const ENROLL_POLL_INTERVAL_MS = 1000

/** 异步入库的结果：每秒读一次开课班，直到当前用户变为「已选」；超过次数仍未选上则返回 null。 */
const waitForEnrollment = async (offeringId: number): Promise<CourseOffering | null> => {
  for (let attempt = 0; attempt < ENROLL_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, ENROLL_POLL_INTERVAL_MS))
    const fresh = await getCourseOfferingDetail(offeringId)
    if (fresh.current_user.enrollment_status === 'selected') return fresh
  }
  return null
}

/** 选课 / 退课失败时优先取 `details[0].reason` 翻译成中文，取不到再回退到服务端 message。 */
const actionErrorMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    const reason = error.response?.data?.details?.[0]?.reason as CourseActionReason | undefined
    if (reason && reason in actionReasonLabels) return actionReasonLabels[reason]
  }
  return apiErrorMessage(error, fallback)
}

/** 我的课表的一项：学生是选课记录（带 offering），教师直接是开课班。 */
const toOffering = (item: MyCourseItem): CourseOffering | null => (item.offering ?? (item.id ? (item as CourseOffering) : null))

type View = 'catalog' | 'my'

/**
 * 课程页。
 *
 * 角色差异（文档 20.2）：
 * · 学生：可选课 / 退课（按钮由 `current_user.can_enroll` / `can_drop` 决定），可看「我的课表」。
 * · 教师：可看目录与「我的课表」（任教开课班），不显示选课按钮。
 * · 管理员：只看目录，不显示「我的课表」与选课按钮。
 */
export function CoursesPage() {
  const role = useAuthStore((state) => state.user?.role)
  const canViewMy = role === 'student' || role === 'teacher'
  const canEnroll = role === 'student'

  const [view, setView] = useState<View>('catalog')

  const [terms, setTerms] = useState<CourseTerm[] | null>(null)
  const [termsError, setTermsError] = useState('')
  const [termId, setTermId] = useState<number | null>(null)

  const [keyword, setKeyword] = useState('')
  const [courseType, setCourseType] = useState<CourseType | ''>('')
  const [page, setPage] = useState(1)
  const [courses, setCourses] = useState<PagedData<CourseListItem> | null>(null)
  const [coursesError, setCoursesError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<CourseDetail | null>(null)
  const [detailError, setDetailError] = useState('')
  const [offerings, setOfferings] = useState<CourseOffering[] | null>(null)
  const [offeringsError, setOfferingsError] = useState('')

  const [pendingId, setPendingId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<{ offeringId: number; message: string } | null>(null)

  const [myItems, setMyItems] = useState<MyCourseItem[] | null>(null)
  const [myError, setMyError] = useState('')

  useEffect(() => {
    let active = true
    getCourseTerms()
      .then((items) => {
        if (!active) return
        setTerms(items)
        const current = items.find((term) => term.is_current) ?? items[0]
        setTermId(current?.id ?? null)
      })
      .catch((error) => {
        if (active) setTermsError(apiErrorMessage(error, '学期信息读取失败'))
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (view !== 'catalog') return
    let active = true
    setCourses(null)
    setCoursesError('')
    getCourses({
      page,
      page_size: PAGE_SIZE,
      keyword: keyword.trim() || undefined,
      course_type: courseType || undefined,
    })
      .then((result) => {
        if (active) setCourses(result)
      })
      .catch((error) => {
        if (active) setCoursesError(apiErrorMessage(error, '课程目录读取失败'))
      })
    return () => {
      active = false
    }
  }, [view, page, keyword, courseType, reloadKey])

  useEffect(() => {
    if (view !== 'my' || termId === null) return
    let active = true
    setMyItems(null)
    setMyError('')
    getMyCourses({ term_id: termId, page: 1, page_size: 100 })
      .then((result) => {
        if (active) setMyItems(result.items)
      })
      .catch((error) => {
        if (active) setMyError(apiErrorMessage(error, '我的课表读取失败'))
      })
    return () => {
      active = false
    }
  }, [view, termId, reloadKey])

  useEffect(() => {
    if (selectedId === null) return
    let active = true
    setDetail(null)
    setDetailError('')
    getCourseDetail(selectedId)
      .then((result) => {
        if (active) setDetail(result)
      })
      .catch((error) => {
        if (active) setDetailError(apiErrorMessage(error, '课程详情读取失败'))
      })
    return () => {
      active = false
    }
  }, [selectedId])

  useEffect(() => {
    if (selectedId === null || termId === null) return
    let active = true
    setOfferings(null)
    setOfferingsError('')
    setActionError(null)
    getCourseOfferings(selectedId, termId)
      .then((items) => {
        if (active) setOfferings(items)
      })
      .catch((error) => {
        if (active) setOfferingsError(apiErrorMessage(error, '开课班读取失败'))
      })
    return () => {
      active = false
    }
  }, [selectedId, termId])

  const changeKeyword = (value: string) => {
    setKeyword(value)
    setPage(1)
  }

  const changeType = (value: CourseType | '') => {
    setCourseType(value)
    setPage(1)
  }

  /** 选课 / 退课成功后，用开课班详情接口刷新这一个班，拿到最新的人数、余量和 current_user。 */
  const runAction = async (offering: CourseOffering, action: 'enroll' | 'drop') => {
    setPendingId(offering.id)
    setActionError(null)
    try {
      let fresh: CourseOffering
      if (action === 'enroll') {
        const termCode = terms?.find((item) => item.id === termId)?.code
        if (selectedId === null || !termCode) throw new Error('未选择课程或学期')
        await enrollWithToken(selectedId, offering.id, termCode)
        // 选课是异步入库，受理后轮询开课班，直到变为「已选」。
        const settled = await waitForEnrollment(offering.id)
        if (!settled) {
          setActionError({ offeringId: offering.id, message: '选课已提交，仍在处理中，请稍后刷新查看' })
          return
        }
        fresh = settled
      } else {
        const termCode = terms?.find((item) => item.id === termId)?.code
        if (selectedId === null || !termCode) throw new Error('未选择课程或学期')
        await dropOffering(selectedId, offering.id, termCode)
        fresh = await getCourseOfferingDetail(offering.id)
      }
      setOfferings((current) => current?.map((item) => (item.id === fresh.id ? fresh : item)) ?? null)
      setReloadKey((key) => key + 1)
    } catch (error) {
      setActionError({
        offeringId: offering.id,
        message: actionErrorMessage(error, action === 'enroll' ? '选课失败，请稍后重试' : '退课失败，请稍后重试'),
      })
    } finally {
      setPendingId(null)
    }
  }

  const renderCatalog = () => {
    if (coursesError) {
      return (
        <div className="course-state">
          <CircleAlert size={28} />
          <h3>课程目录暂时无法加载</h3>
          <p>{coursesError}</p>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)}>重试</button>
        </div>
      )
    }
    if (!courses) return <div className="course-state">正在读取课程目录...</div>
    if (courses.items.length === 0) {
      return (
        <div className="course-state">
          <BookOpen size={28} />
          <h3>没有找到课程</h3>
          <p>{keyword || courseType ? '换个关键词或课程类型试试。' : '课程目录暂时为空。'}</p>
        </div>
      )
    }
    return (
      <>
        <div className="course-list">
          {courses.items.map((course) => (
            <button
              key={course.id}
              type="button"
              className={`course-row ${course.course_type}${selectedId === course.id ? ' active' : ''}`}
              onClick={() => setSelectedId(course.id)}
              aria-pressed={selectedId === course.id}
            >
              <div className="course-row-head">
                <strong>{course.name}</strong>
                <span className={`course-tag ${course.course_type}`}>{courseTypeLabels[course.course_type]}</span>
              </div>
              <div className="course-row-meta">
                <span>{course.course_code}</span>
                <span>{course.credit} 学分</span>
                <span>{course.total_hours} 学时</span>
                {course.organization && <span>{course.organization.name}</span>}
              </div>
            </button>
          ))}
        </div>
        <div className="course-pager">
          <span>第 {courses.page} 页 · 共 {courses.total} 门</span>
          <div>
            <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>上一页</button>{' '}
            <button type="button" disabled={!courses.has_more} onClick={() => setPage((current) => current + 1)}>下一页</button>
          </div>
        </div>
      </>
    )
  }

  const renderOffering = (offering: CourseOffering) => {
    const schedules = offering.schedules ?? []
    const location = schedules.find((item) => item.location)?.location
    const showActions = canEnroll && offering.current_user
    const busy = pendingId === offering.id
    const error = actionError?.offeringId === offering.id ? actionError.message : null

    return (
      <article key={offering.id} className="course-offering" data-status={offering.selection_status}>
        <div className="course-offering-head">
          <span>第 {offering.section_no} 班</span>
          <span className="course-tag">{selectionLabels[offering.selection_status]}</span>
        </div>
        <dl>
          <dt>任课教师</dt>
          <dd>{offering.teacher?.name || '待定'}</dd>
          <dt>校区</dt>
          <dd>{offering.campus ?? '—'}</dd>
          <dt>余量</dt>
          <dd>
            <div className="course-capacity">
              <Users size={13} />
              <span>{offering.remaining} / {offering.capacity}</span>
              <div className="course-capacity-bar" aria-hidden="true">
                <i
                  className={offering.remaining === 0 ? 'full' : offering.remaining / Math.max(offering.capacity, 1) < 0.2 ? 'tight' : ''}
                  style={{ width: `${Math.min(100, (offering.enrolled_count / Math.max(offering.capacity, 1)) * 100)}%` }}
                />
              </div>
            </div>
          </dd>
          <dt>上课时间</dt>
          <dd>
            {schedules.length === 0
              ? '待定'
              : schedules.map((item, index) => (
                  <span key={index} className="course-schedule-line">
                    <Clock3 size={13} /> {formatSchedule(item)}
                  </span>
                ))}
          </dd>
          {location && (
            <>
              <dt>地点</dt>
              <dd>
                <MapPin size={13} /> {location}
              </dd>
            </>
          )}
          {offering.current_user?.enrollment_status && (
            <>
              <dt>我的状态</dt>
              <dd>{enrollmentLabels[offering.current_user.enrollment_status]}</dd>
            </>
          )}
        </dl>
        {showActions && (
          <div className="course-offering-actions">
            {offering.current_user.can_enroll && (
              <button type="button" className="primary-button" disabled={busy} onClick={() => runAction(offering, 'enroll')}>
                {busy ? '处理中...' : '选课'}
              </button>
            )}
            {offering.current_user.can_drop && (
              <button type="button" disabled={busy} onClick={() => runAction(offering, 'drop')}>
                {busy ? '处理中...' : '退课'}
              </button>
            )}
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
      </article>
    )
  }

  const renderDetail = () => {
    if (selectedId === null) {
      return (
        <div className="course-state">
          <BookOpen size={28} />
          <h3>选择一门课程</h3>
          <p>左侧点选课程后，这里显示所选学期的开课班与上课时间。</p>
        </div>
      )
    }
    if (detailError) {
      return (
        <div className="course-state">
          <CircleAlert size={28} />
          <h3>课程详情暂时无法加载</h3>
          <p>{detailError}</p>
        </div>
      )
    }
    if (!detail) return <div className="course-state">正在读取课程详情...</div>

    const term = terms?.find((item) => item.id === termId)
    return (
      <>
        <h2>{detail.name}</h2>
        <div className="course-row-meta">
          <span>{detail.course_code}</span>
          <span>{detail.credit} 学分</span>
          <span>{detail.total_hours} 学时</span>
          {detail.english_name && <span>{detail.english_name}</span>}
        </div>
        {detail.description && <p className="course-detail-desc">{detail.description}</p>}
        {detail.prerequisites.length > 0 && (
          <p className="muted">先修课程：{detail.prerequisites.map((item) => item.name).join('、')}</p>
        )}

        <h3>{term ? `${term.name} 开课班` : '开课班'}</h3>
        {offeringsError ? (
          <div className="course-state">
            <CircleAlert size={28} />
            <h3>开课班暂时无法加载</h3>
            <p>{offeringsError}</p>
          </div>
        ) : !offerings ? (
          <div className="course-state">正在读取开课班...</div>
        ) : offerings.length === 0 ? (
          <div className="course-state">
            <Clock3 size={28} />
            <h3>本学期暂未开课</h3>
            <p>这门课在所选学期没有开课班。</p>
          </div>
        ) : (
          offerings.map(renderOffering)
        )}
      </>
    )
  }

  const renderMy = () => {
    if (myError) {
      return (
        <div className="course-state">
          <CircleAlert size={28} />
          <h3>我的课表暂时无法加载</h3>
          <p>{myError}</p>
          <button type="button" onClick={() => setReloadKey((key) => key + 1)}>重试</button>
        </div>
      )
    }
    if (!myItems) return <div className="course-state">正在读取我的课表...</div>
    const offeringsList = myItems.map(toOffering).filter((item): item is CourseOffering => item !== null)
    if (offeringsList.length === 0) {
      return (
        <div className="course-state">
          <Clock3 size={28} />
          <h3>本学期还没有课程</h3>
          <p>{role === 'teacher' ? '你在所选学期没有任教的开课班。' : '在课程目录中选课后，会显示在这里。'}</p>
        </div>
      )
    }
    return (
      <div className="course-list">
        {myItems.map((item, index) => {
          const offering = toOffering(item)
          if (!offering) return null
          const status = item.enrollment_status
          return (
            <div key={item.enrollment_id ?? offering.id ?? index} className="course-row">
              <div className="course-row-head">
                <strong>{offering.course.name}</strong>
                {status && <span className="course-tag">{enrollmentLabels[status]}</span>}
              </div>
              <div className="course-row-meta">
                <span>{offering.course.course_code}</span>
                <span>第 {offering.section_no} 班</span>
                <span>{offering.teacher?.name || '待定'}</span>
              </div>
              {(offering.schedules ?? []).map((schedule, scheduleIndex) => (
                <span key={scheduleIndex} className="course-schedule-line">
                  <Clock3 size={13} /> {formatSchedule(schedule)}
                </span>
              ))}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <section className="page">
      <header className="page-heading course-hero">
        <div className="course-title-group">
          <p className="eyebrow">COURSE CENTER</p>
          <div className="course-title-line">
            <h1>{view === 'my' ? '我的课表' : '课程目录'}</h1>
            <div className="course-summary-pills">
              <span className="course-pill">
                <i className="course-pill-dot" />
                {terms?.find((term) => term.id === termId)?.code ?? '学期加载中'}
              </span>
              {view === 'catalog' && (
                <span className="course-pill">
                  <i className="course-pill-dot success" />
                  {courses?.total ?? '—'} 门课程
                </span>
              )}
              {view === 'my' && myItems && (
                <span className="course-pill">
                  <i className="course-pill-dot ping" />
                  {myItems.length} 门已选
                </span>
              )}
            </div>
          </div>
        </div>
      </header>

      {canViewMy && (
        <div className="course-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={view === 'catalog'} className={view === 'catalog' ? 'active' : ''} onClick={() => setView('catalog')}>
            课程目录
          </button>
          <button type="button" role="tab" aria-selected={view === 'my'} className={view === 'my' ? 'active' : ''} onClick={() => setView('my')}>
            我的课表
          </button>
        </div>
      )}

      <div className="course-toolbar">
        {view === 'catalog' && (
          <>
            <label className="course-search">
              <Search size={16} />
              <input
                type="search"
                placeholder="搜索课程名称或编号"
                aria-label="搜索课程"
                value={keyword}
                onChange={(event) => changeKeyword(event.target.value)}
              />
            </label>
            <select aria-label="课程类型" value={courseType} onChange={(event) => changeType(event.target.value as CourseType | '')}>
              <option value="">全部类型</option>
              {(Object.keys(courseTypeLabels) as CourseType[]).map((type) => (
                <option key={type} value={type}>{courseTypeLabels[type]}</option>
              ))}
            </select>
          </>
        )}
        {termsError ? (
          <span className="muted">{termsError}</span>
        ) : terms ? (
          <select aria-label="学期" value={termId ?? ''} onChange={(event) => setTermId(Number(event.target.value))}>
            {terms.map((term) => (
              <option key={term.id} value={term.id}>{term.name}{term.is_current ? '（当前）' : ''}</option>
            ))}
          </select>
        ) : null}
      </div>

      {view === 'catalog' ? (
        <div className="course-layout">
          <div>{renderCatalog()}</div>
          <aside className="course-detail">{renderDetail()}</aside>
        </div>
      ) : (
        <div className="course-my">{renderMy()}</div>
      )}
    </section>
  )
}
