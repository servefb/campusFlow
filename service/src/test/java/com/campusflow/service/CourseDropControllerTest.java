package com.campusflow.service;

import com.campusflow.service.controller.CoursesController;
import com.campusflow.service.entity.vo.CourseDropVO;
import com.campusflow.service.exception.CourseOperationException;
import com.campusflow.service.exception.GlobalExceptionHandler;
import com.campusflow.service.service.CourseDropService;
import com.campusflow.service.service.ICoursesService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class CourseDropControllerTest {
    private final CourseDropService service = mock(CourseDropService.class);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(new CoursesController(mock(ICoursesService.class), service))
                .setControllerAdvice(new GlobalExceptionHandler()).build();
    }

    @Test
    void returnsDocumentedSuccessFields() throws Exception {
        when(service.dropCourse(101L, 501L, "2026Fall"))
                .thenReturn(new CourseDropVO(501L, "dropped", 98, 22));
        mvc.perform(delete("/courses/101/offerings/501/enroll").param("term_code", "2026Fall"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.offering_id").value(501))
                .andExpect(jsonPath("$.data.enrollment_status").value("dropped"))
                .andExpect(jsonPath("$.data.enrolled_count").value(98))
                .andExpect(jsonPath("$.data.remaining").value(22));
    }

    @Test
    void missingTermReturns40001() throws Exception {
        mvc.perform(delete("/courses/101/offerings/501/enroll"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value(40001));
        verifyNoInteractions(service);
    }

    @Test
    void conflictUsesHttp409AndDetailsReason() throws Exception {
        when(service.dropCourse(101L, 501L, "2026Fall"))
                .thenThrow(new CourseOperationException(409, 40900, "当前未选该开课班", "not_enrolled"));
        mvc.perform(delete("/courses/101/offerings/501/enroll").param("term_code", "2026Fall"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value(40900))
                .andExpect(jsonPath("$.details[0].reason").value("not_enrolled"));
    }
}
