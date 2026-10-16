package com.campusflow.service.service.impl;

import com.baomidou.mybatisplus.extension.conditions.query.LambdaQueryChainWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.context.UserContext;
import com.campusflow.common.exception.BizException;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.CoursesDto;
import com.campusflow.service.entity.po.*;
import com.campusflow.service.entity.vo.CourseSelectionVO;
import com.campusflow.service.entity.vo.CursorDetailVo;
import com.campusflow.service.entity.vo.CursorVo;
import com.campusflow.service.entity.vo.EnrollmentListVO;
import com.campusflow.service.mapper.CoursesMapper;
import com.campusflow.service.service.*;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.jetbrains.annotations.NotNull;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.scripting.support.ResourceScriptSource;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * <p>
 * 服务实现类
 * </p>
 *
 * @author JIA
 * @since 2026-10-12
 */
@Service
@RequiredArgsConstructor
public class CoursesServiceImpl extends ServiceImpl<CoursesMapper, Courses> implements ICoursesService {


    private final IAcademicTermsService academicTermsService;
    private final IOrganizationsService organizationsService;
    private final ICourseOfferingsService courseOfferingsService;
    private final ICourseEnrollmentsService courseEnrollmentsService;

    private final ICourseSchedulesService courseSchedulesService;
    private final IUsersService usersService;

    private final StringRedisTemplate stringRedisTemplate;

    private final ICoursePrerequisitesService coursePrerequisitesService;

    public static final String SELECT_COURSE_KEY = "campusflow:course:select:";

    public static final String COURSE_STORE = "campusflow:course:store:";
    public static final String COURSE_STATUS = "campusflow:course:status:";
    public static final String COURSE_PREREQ = "campusflow:course:prerequisite:";
    public static final String OFFERING_BITMAP = "campusflow:offering:bitmap:";
    public static final String STUDENT_OFFERING_BITMAP = "campusflow:student:offering:bitmap:";
    public static final String STUDENT_PASSED = "campusflow:student:passed:";
    public static final String TMP_BITMAP = "campusflow:tmp:bitmap:";
    public static final String STUDENT_SELECTED = "campusflow:student:selected:";
    public static final String SELECTION_STREAM = "campusflow:selection:stream:";




    @Override
    public Result<List<CursorVo>> getCourses(CoursesDto coursesDto) {

        Page<Courses> page = lambdaQuery().like(coursesDto.getKeyword() != null, Courses::getName, coursesDto.getKeyword())
                .eq(coursesDto.getCourse_type() != null, Courses::getCourseType, coursesDto.getCourse_type())
                .eq(coursesDto.getOrganization_id() != null, Courses::getOrganizationId, coursesDto.getOrganization_id())
                .orderBy(coursesDto.getSort() != null, Boolean.TRUE.equals(coursesDto.getSort()), Courses::getId)
                .page(new Page<>(coursesDto.getPage(), coursesDto.getPage_size()));
        List<Courses> records = page.getRecords();
        if (records == null || records.isEmpty()) {
            return Result.failure(400, "课程为空");

        }
        List<CursorVo> cursorVoList = getCursorVos(records);
        return new Result<List<CursorVo>>().success(cursorVoList);
    }

    @NotNull
    private List<CursorVo> getCursorVos(List<Courses> records) {
        List<Long> organizationIds = records.stream().map(Courses::getOrganizationId).toList();
        List<Organizations> list = organizationsService.lambdaQuery().in(Organizations::getId, organizationIds).list();
        Map<Long, String> organizationMap = list.stream().collect(Collectors.toMap(Organizations::getId, Organizations::getName));
        List<CursorVo> cursorVoList = new LinkedList<>();
        records.forEach(co -> {
            CursorVo cursorVo = new CursorVo();
            cursorVo.setId(co.getId());
            cursorVo.setCourse_code(co.getCourseCode());
            cursorVo.setName(co.getName());
            cursorVo.setEnglish_name(co.getEnglishName());
            cursorVo.setCourse_type(co.getCourseType());
            cursorVo.setCredit(co.getCredit());
            cursorVo.setTotal_hours(co.getTotalHours());
            cursorVo.setOrganization(new CursorVo.OrganizationVo(co.getOrganizationId(), organizationMap.get(co.getOrganizationId())));
            cursorVoList.add(cursorVo);
        });
        return cursorVoList;
    }

    @Override
    public Result<CursorDetailVo> getCourseById(Long courseId) {
        Courses byId = getById(courseId);
        if (byId == null) {
            return Result.failure(40400, "课程不存在");
        }
        List<CursorVo> cursorVos = getCursorVos(List.of(byId));
        CursorDetailVo cursorDetailVo = new CursorDetailVo();
        cursorDetailVo.setCursor(cursorVos.get(0));
        cursorDetailVo.setDescription(byId.getDescription());
        cursorDetailVo.setPrerequisites(List.of(new CursorDetailVo.Prerequisite(byId.getId(), byId.getCourseCode(), byId.getName())));
        return new Result<CursorDetailVo>().success(cursorDetailVo);
    }

    @Override
    public Result<?> getCourseOfferings(Long courseId, Integer termId) {
        if (courseId == null || termId == null) {
            return Result.failure(40001, "course_id 和 term_id 必传");
        }
        if (getById(courseId) == null) {
            return Result.failure(40400, "课程不存在");
        }
        if (academicTermsService.getById(termId) == null) {
            return Result.failure(40400, "学期不存在");
        }
        List<CourseOfferings> offerings = courseOfferingsService.lambdaQuery()
                .eq(CourseOfferings::getCourseId, courseId)
                .eq(CourseOfferings::getTermId, termId)
                .orderByAsc(CourseOfferings::getSectionNo).list();
        return new Result<>().success(Map.of("items", buildOfferingViews(offerings)));
    }
    @Override
    public Result<?> getMyCourses(Integer termId, Integer page, Integer pageSize) {

        List<CourseOfferings> courseOfferingsList = courseOfferingsService.lambdaQuery().eq(CourseOfferings::getTermId, termId).list();

        Map<Long, CourseOfferings> collect = courseOfferingsList.stream().collect(Collectors.toMap(CourseOfferings::getId, e -> e));

        Page<CourseEnrollments> queryPage = courseEnrollmentsService.lambdaQuery().eq(CourseEnrollments::getUserId, UserContext.getUserId())
                .in(CourseEnrollments::getOfferingId, collect.keySet())
                .page(new Page<>(page, pageSize));


        List<CourseEnrollments> courseEnrollmentsList = queryPage.getRecords();

        if (courseEnrollmentsList == null || courseEnrollmentsList.isEmpty()) {
            return Result.failure(40400, "没有找到相关课程");
        }

        List<EnrollmentListVO.Item> enrollmentListVOList = new LinkedList<>();
        List<Long> cursorId = new ArrayList<>();
        List<Long> teacherIds = new ArrayList<>();
        List<Long> schedulesIds = new ArrayList<>();
        courseEnrollmentsList.forEach(ce -> {

            EnrollmentListVO.Item item = new EnrollmentListVO.Item();

            item.setEnrollment_id(ce.getId());
            item.setEnrollment_status(ce.getStatus());
            item.setSelected_at(ce.getSelectedAt() == null ? null : ce.getSelectedAt().toString());
            item.setFinal_grade(ce.getFinalGrade());
            item.setOffering(
                    new EnrollmentListVO.Offering(
                            ce.getOfferingId()
                    )
            );
            if (collect.containsKey(ce.getOfferingId())) {
                cursorId.add(collect.get(ce.getOfferingId()).getCourseId());
                teacherIds.add(collect.get(ce.getOfferingId()).getTeacherUserId());
                schedulesIds.add(collect.get(ce.getOfferingId()).getId());
            }
            enrollmentListVOList.add(item);
        });

        List<Users> user = usersService.lambdaQuery().in(Users::getId, teacherIds).list();
        Map<Long, Users> teacherMap = user.stream().collect(Collectors.toMap(Users::getId, u -> u));


        List<Courses> list = lambdaQuery().in(Courses::getId, cursorId).list();
        Map<Long, Courses> coursesMap = list.stream().collect(Collectors.toMap(Courses::getId, e -> e));

        Map<Long, List> schedulesMap = new HashMap<>();
        getSchedulesMap(schedulesIds, schedulesMap);

        for (EnrollmentListVO.Item item : enrollmentListVOList) {

            EnrollmentListVO.Offering offering = item.getOffering();
            Long id = offering.getId();
            CourseOfferings courseOfferings = collect.get(id);
            Long courseId = courseOfferings.getCourseId();
            Courses courses = coursesMap.get(courseId);
            offering.setCourse(new EnrollmentListVO.Course(courses.getId(), courses.getCourseCode(), courses.getName(), courses.getCredit().doubleValue()));


            offering.setSection_no(courseOfferings.getSectionNo());
            Long teacherUserId = courseOfferings.getTeacherUserId();
            if (teacherUserId != null) {
                Users teacher = teacherMap.get(teacherUserId);
                offering.setTeacher(new EnrollmentListVO.Teacher(teacher.getId(), teacher.getName()));
            } else {
                offering.setTeacher(null);
            }
            offering.setSchedules(schedulesMap.get(id));
        }

        BaseQueryVo<EnrollmentListVO.Item> baseQueryVo = new BaseQueryVo<>();


        baseQueryVo.setItems(enrollmentListVOList);
        baseQueryVo.setTotal(queryPage.getTotal());
        baseQueryVo.setPage(page);
        baseQueryVo.setPage_size(pageSize);
        baseQueryVo.setHas_more(queryPage.hasNext());
        return new Result<BaseQueryVo<EnrollmentListVO.Item>>().success(baseQueryVo);
    }

    @Override
    public Result<?> getEnrollToken(Long offeringId) {

        Long userId = UserContext.getUserId();
        String key = SELECT_COURSE_KEY + offeringId + ":" + userId;

        String string = UUID.randomUUID().toString();

        stringRedisTemplate.opsForValue().set(key + string, "1", Duration.ofMinutes(5));

        return new Result<>().success(Map.of("token", string));


    }

//    @Override
//    public Result<?> enrollCourse(Long offeringId, HttpServletRequest request) {
//
//        Long userId = UserContext.getUserId();
//        String key = SELECT_COURSE_KEY + offeringId + ":" + userId;
//        CourseOfferings courseOffering = courseOfferingsService.getById(offeringId);
//        String COURSE_STOCK_KEY = COURSE_STOCK + offeringId;
//        if (!stringRedisTemplate.hasKey(COURSE_STOCK_KEY)){
//            stringRedisTemplate.opsForValue().set(COURSE_STOCK_KEY, courseOffering.getCapacity().toString());
//        }
//
//
//        String header = request.getHeader("Idempotency-Token");
//        if (header == null) {
//            return Result.failure(400, "Missing idempotency token");
//        }
//
//        DefaultRedisScript<Long> script = new DefaultRedisScript<>();
//        script.setScriptSource(new ResourceScriptSource(
//                new ClassPathResource("lua/enrollCourse.lua")));
//        script.setResultType(Long.class);
//
//        Long execute = stringRedisTemplate.execute(script, Collections.singletonList(key + header));
//        if (execute == 0) {
//            throw new BizException("请勿重复提交");
//        }
//
//        if (courseOffering == null) {
//            throw new BizException("课程不存在");
//        }
//        if (!courseOffering.getSelectionStatus().equals("open")) {
//            throw new BizException("课程未开放选课");
//        }
//        if (courseOffering.getCapacity() <= courseOffering.getEnrolledCount()) {
//            throw new BizException("课程已满");
//        }
//        CoursePrerequisites coursePrerequisite = coursePrerequisitesService.lambdaQuery().eq(CoursePrerequisites::getCourseId, courseOffering.getCourseId()).one();
//        if (coursePrerequisite != null) {
//            Long prerequisiteCourseId = coursePrerequisite.getPrerequisiteCourseId();
//            List<CourseOfferings> list = courseOfferingsService.lambdaQuery().eq(CourseOfferings::getCourseId, prerequisiteCourseId).list();
//            List<Long> ids = list.stream().map(CourseOfferings::getId).toList();
//            CourseEnrollments one = courseEnrollmentsService.lambdaQuery().eq(CourseEnrollments::getUserId, userId)
//                    .notIn(CourseEnrollments::getOfferingId, ids)
//                    .one();
//            if (one == null) {
//                throw new BizException("您未选修先修课程");
//            }
//        }
//        CourseEnrollments one = courseEnrollmentsService.lambdaQuery().eq(CourseEnrollments::getUserId, userId)
//                .eq(CourseEnrollments::getOfferingId, offeringId)
//                .one();
//        if (one != null) {
//            throw new BizException("您已选过此课程");
//        }
//        List<CourseEnrollments> list = courseEnrollmentsService.lambdaQuery().eq(CourseEnrollments::getUserId, userId)
//                .eq(CourseEnrollments::getStatus, "selected")
//                .list();
//        List<Long> offeringIds = list.stream()
//                .map(CourseEnrollments::getOfferingId)
//                .collect(Collectors.toCollection(ArrayList::new));
//        offeringIds.add(offeringId);
//        List<CourseSchedules> courseSchedulesList = courseSchedulesService.lambdaQuery().in(CourseSchedules::getOfferingId, offeringIds).list();
//        Map<Long, List<CourseSchedules>> CourseSchedulesMap = new HashMap<>();
//        courseSchedulesList.forEach(schedule -> {
//            CourseSchedulesMap.computeIfAbsent(schedule.getOfferingId(), k -> new ArrayList<CourseSchedules>()).add(schedule);
//        });
//        Set<Long> offeringIdSet = CourseSchedulesMap.keySet();
//        List<CourseSchedules> goalSchedules = CourseSchedulesMap.get(offeringId);
//        List<Slot> target = new ArrayList<>();
//        goalSchedules.forEach(schedule -> {
//            Slot slot = Slot.of(schedule.getWeekday(), schedule.getStartPeriod(), schedule.getEndPeriod(), schedule.getWeekRange());
//            target.add(slot);
//        });
//        CourseSchedulesMap.remove(offeringId);
//        for (Long l : offeringIdSet) {
//            List<Slot> selected = CourseSchedulesMap.get(l).stream().map(schedule -> Slot.of(schedule.getWeekday(), schedule.getStartPeriod(), schedule.getEndPeriod(), schedule.getWeekRange())).toList();
//            if (hasConflict(target, selected)) {
//                throw new BizException("课程冲突");
//            }
//        }
//
//        boolean update = courseOfferingsService.lambdaUpdate()
//                .eq(CourseOfferings::getId, offeringId)
//                .setSql("enrolled_count = enrolled_count + 1")
//                .apply("enrolled_count < capacity")
//                .update();
//        if (!update) {
//            throw new BizException("课程容量不足");
//        }
//        CourseEnrollments courseEnrollments = new CourseEnrollments();
//        courseEnrollments.setUserId(userId);
//        courseEnrollments.setOfferingId(offeringId);
//        courseEnrollments.setStatus("selected");
//        courseEnrollmentsService.save(courseEnrollments);
//
//        Map<String, String> voMap = new HashMap<>();
//        voMap.put("offeringId", courseOffering.getId().toString());
//        voMap.put("enrollmentStatus", "selected");
//        voMap.put("enrolledCount", courseOffering.getEnrolledCount().toString());
//        voMap.put("remaining", (courseOffering.getCapacity() - courseOffering.getEnrolledCount())+"");
//        return new Result().success(voMap);
//    }


    @Override
    public Result<?> enrollCourse(Long offeringId, Long course_id, HttpServletRequest request, String term_code) {

        Long userId = UserContext.getUserId();
        String header = request.getHeader("Idempotency-Token");
        if (header == null) {
            return Result.failure(400, "Missing idempotency token");
        }

        Set<String> prereqs = stringRedisTemplate.opsForSet().members(COURSE_PREREQ + "{" + term_code + "}" + course_id);
        if (prereqs != null && !prereqs.isEmpty()) {
            Set<String> passed = stringRedisTemplate.opsForSet().members(STUDENT_PASSED+"{" + term_code + "}" + userId);
            List<String> offeringIds = new ArrayList<>();
            if (passed == null) {
                List<CourseEnrollments> list = courseEnrollmentsService.lambdaQuery().eq(CourseEnrollments::getUserId, userId).eq(CourseEnrollments::getStatus, "completed").list();
                if (list.isEmpty()) {
                    throw new BizException(-5, "前修课程未修完");
                }

                offeringIds = list.stream().map(co->co.getOfferingId().toString()).toList();

                // 回写 Redis
                stringRedisTemplate.opsForSet().add(STUDENT_PASSED+"{" + term_code + "}" + userId, offeringIds.toArray(new String[0]));
            }
            Set<String> missing = new HashSet<>(prereqs);
            missing.removeAll(offeringIds);
            if (!missing.isEmpty()) {
                throw new BizException(-5, "前修课程未修完");
            }
        }

        DefaultRedisScript<Long> script = new DefaultRedisScript<>();
        script.setScriptSource(new ResourceScriptSource(
                new ClassPathResource("lua/enrollCourse.lua")));
        script.setResultType(Long.class);

        String key = SELECT_COURSE_KEY + offeringId + ":" + userId;
        List<String> keys = List.of(
                key +header,   // KEYS[1] token
                COURSE_STORE + "{" + term_code + "}:" + offeringId,                        // KEYS[2] stock
                COURSE_STATUS + "{" + term_code + "}:" + offeringId,                       // KEYS[3] status
                OFFERING_BITMAP + "{" + term_code + "}:" + offeringId,                     // KEYS[4] courseBitmap
                STUDENT_OFFERING_BITMAP + "{" + term_code + "}:" + userId,                 // KEYS[5] studentBitmap
                TMP_BITMAP + "{" + term_code + "}:"+ offeringId,                          // KEYS[6] tmpBitmap
                SELECTION_STREAM + "{" + term_code + "}" ,                                 // KEYS[7] selectionQueue
                STUDENT_SELECTED + "{" + term_code + "}:" + userId
        );
        Long code = stringRedisTemplate.execute(script, keys, userId.toString(),
                offeringId.toString());

        if (code == 1) {
            return new Result<>().success("选课成功");
        }

        // 失败统一抛 BizException，由全局异常处理器返回给前端
        switch (code.intValue()) {
            case 0 -> throw new BizException("请勿重复提交");
            case -1 -> throw new BizException("名额已满");
            case -2 -> throw new BizException("时间冲突");
            case -3 -> throw new BizException("课程未开放");
            case -4 -> throw new BizException("系统繁忙，请稍后重试");
            case -6 -> throw new BizException("您已选过该课程");
            default -> throw new BizException("未知错误");
        }
    }

    @Override
    public Result<?> getCourseOffering(Long offeringId) {
        CourseOfferings offering = courseOfferingsService.getById(offeringId);
        if (offering == null) {
            return Result.failure(40400, "开课班不存在");
        }
        return new Result<>().success(buildOfferingViews(List.of(offering)).get(0));
    }

    private List<CourseSelectionVO> buildOfferingViews(List<CourseOfferings> offerings) {
        if (offerings.isEmpty()) {
            return List.of();
        }
        Long userId = UserContext.getUserId();
        Users user = userId == null ? null : usersService.getById(userId);
        String role = user == null ? null : user.getRole();
        List<Long> offeringIds = offerings.stream().map(CourseOfferings::getId).toList();
        List<CourseEnrollments> enrollments = "student".equals(role)
                ? courseEnrollmentsService.lambdaQuery().eq(CourseEnrollments::getUserId, userId)
                .in(CourseEnrollments::getOfferingId, offeringIds).list()
                : List.of();
        // 优先保留最近的记录，避免历史记录导致 toMap 重复键异常。
        Map<Long, CourseEnrollments> enrollmentMap = enrollments.stream().collect(Collectors.toMap(
                CourseEnrollments::getOfferingId, e -> e,
                (a, b) -> a.getId() != null && b.getId() != null && a.getId() > b.getId() ? a : b));
        Set<Long> courseIds = offerings.stream().map(CourseOfferings::getCourseId).collect(Collectors.toSet());
        Map<Long, Courses> courses = listByIds(courseIds).stream().collect(Collectors.toMap(Courses::getId, c -> c));
        Set<Long> termIds = offerings.stream().map(CourseOfferings::getTermId).collect(Collectors.toSet());
        Map<Long, AcademicTerms> terms = academicTermsService.listByIds(termIds).stream()
                .collect(Collectors.toMap(AcademicTerms::getId, t -> t));
        Set<Long> teacherIds = offerings.stream().map(CourseOfferings::getTeacherUserId)
                .filter(Objects::nonNull).collect(Collectors.toSet());
        Map<Long, Users> teachers = teacherIds.isEmpty() ? Map.of() : usersService.listByIds(teacherIds)
                .stream().collect(Collectors.toMap(Users::getId, t -> t));
        Set<Long> scheduleIds = offerings.stream().map(CourseOfferings::getId).collect(Collectors.toSet());

        Map<Long, List<CourseSchedules>> schedules = courseSchedulesService.lambdaQuery()
                .in(CourseSchedules::getOfferingId, scheduleIds).list().stream()
                .collect(Collectors.groupingBy(CourseSchedules::getOfferingId));
        LocalDateTime now = LocalDateTime.now(java.time.ZoneId.of("Asia/Shanghai"));
        List<CourseSelectionVO> views = new ArrayList<>();
        for (CourseOfferings offering : offerings) {
            CourseSelectionVO view = new CourseSelectionVO();
            view.setId(offering.getId());
            Courses course = courses.get(offering.getCourseId());
            if (course != null) {
                view.setCourse(new CourseSelectionVO.Course(course.getId(), course.getCourseCode(),
                        course.getName(), course.getCredit() == null ? null : course.getCredit().doubleValue()));
            }
            AcademicTerms term = terms.get(offering.getTermId());
            if (term != null) {
                view.setTerm(new CourseSelectionVO.Term(term.getId(), term.getTermCode(), term.getTermName()));
            }
            view.setSection_no(offering.getSectionNo());
            Users teacher = offering.getTeacherUserId() == null ? null : teachers.get(offering.getTeacherUserId());
            view.setTeacher(teacher == null ? null : new CourseSelectionVO.Teacher(teacher.getId(), teacher.getName()));
            view.setCampus(offering.getCampus());
            view.setCapacity(offering.getCapacity());
            view.setEnrolled_count(offering.getEnrolledCount());
            view.setRemaining(offering.getCapacity() - offering.getEnrolledCount());
            view.setSelection_status(offering.getSelectionStatus());
            view.setSelection_start_at(offering.getSelectionStartAt() == null ? null : offering.getSelectionStartAt().toString());
            view.setSelection_end_at(offering.getSelectionEndAt() == null ? null : offering.getSelectionEndAt().toString());
            List<CourseSchedules> targetSchedules = schedules.getOrDefault(offering.getId(), List.of());
            view.setSchedules(targetSchedules.stream().map(s -> new CourseSelectionVO.Schedule(s.getWeekday(),
                    s.getStartPeriod(), s.getEndPeriod(), s.getWeekRange(), s.getLocation())).toList());
            CourseEnrollments enrollment = enrollmentMap.get(offering.getId());
            view.setCurrent_user(com.campusflow.service.support.CourseSelectionPolicy.evaluate(role,
                    enrollment == null ? null : enrollment.getStatus(), offering, now));
            views.add(view);
        }
        return views;
    }

    private void getSchedulesMap(List<Long> schedulesIds, Map<Long, List> schedulesMap) {
        List<CourseSchedules> courseSchedules = courseSchedulesService.lambdaQuery().in(CourseSchedules::getOfferingId, schedulesIds).list();
        courseSchedules.forEach(schedule -> {
            schedulesMap.computeIfAbsent(schedule.getOfferingId(), k -> new LinkedList<>()).add(new CourseSelectionVO.Schedule(schedule.getWeekday(), schedule.getStartPeriod(), schedule.getEndPeriod(), schedule.getWeekRange(), schedule.getLocation()));
        });


    }

}
