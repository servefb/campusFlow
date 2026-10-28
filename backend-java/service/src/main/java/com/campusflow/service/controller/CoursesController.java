package com.campusflow.service.controller;


import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.CoursesDto;
import com.campusflow.service.service.ICoursesService;
import com.campusflow.service.service.CourseDropService;
import com.campusflow.service.exception.CourseOperationException;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

/**
 * <p>
 * 前端控制器
 * </p>
 *
 * @author JIA
 * @since 2026-10-12
 */
@RestController
@RequestMapping("/courses")
@RequiredArgsConstructor
public class CoursesController {

    private final ICoursesService courseService;
    private final CourseDropService courseDropService;

    @GetMapping
    public Result<?> getCourses(CoursesDto coursesDto) {
        return courseService.getCourses(coursesDto);
    }


    @GetMapping("/{course_id}")
    public Result<?> getCourseById(@PathVariable Long course_id) {
        return courseService.getCourseById(course_id);
    }


    @GetMapping("/{course_id}/offerings")
    public Result<?> getCourseOfferings(@PathVariable Long course_id, Integer term_id) {
        return courseService.getCourseOfferings(course_id, term_id);
    }

    @GetMapping("/my")
    public Result<?> getMyCourses(Integer term_id, Integer page, Integer page_size) {
        return courseService.getMyCourses(term_id, page, page_size);
    }

    @PostMapping("/offerings/{offering_id}/enroll-token")
    public Result<?> getEnrollToken(@PathVariable Long offering_id) {
        return courseService.getEnrollToken(offering_id);
    }

    @PostMapping("/{course_id}/offerings/{offering_id}/enroll")
    public Result<?> enrollCourse(@PathVariable Long offering_id, @PathVariable Long course_id,String term_code,HttpServletRequest request) {
        return courseService.enrollCourse(offering_id,course_id ,request,term_code);
    }

    @GetMapping("/offerings/{offering_id}")
    public Result<?> getCourseOffering(@PathVariable Long offering_id) {
        return courseService.getCourseOffering(offering_id);
    }

    @DeleteMapping("/{course_id}/offerings/{offering_id}/enroll")
    public Result<?> dropCourse(@PathVariable("course_id") Long courseId,
                               @PathVariable("offering_id") Long offeringId,
                               @RequestParam(value = "term_code", required = false) String termCode) {
        // Return the documented 40001 rather than the generic missing-parameter handler.
        if (termCode == null || termCode.isBlank()) {
            throw new CourseOperationException(400, 40001, "term_code 必传", "invalid_parameter");
        }
        return new Result<>().success(courseDropService.dropCourse(courseId, offeringId, termCode));
    }

}
