package com.campusflow.common.constant;

import java.util.List;

public interface RoleConstant {

    String ROLE_ADMIN = "admin";
    String ROLE_PUBLIC = "public";
    String ROLE_CAMPUS = "campus";
    String ROLE_STUDENT = "student";
    String ROLE_TEACHER = "teacher";
    String ROLE_DEPARTMENT = "department";

    static List<String> getRoles() {
        return List.of(ROLE_ADMIN, ROLE_PUBLIC, ROLE_CAMPUS, ROLE_STUDENT, ROLE_TEACHER, ROLE_DEPARTMENT);
    }
}
