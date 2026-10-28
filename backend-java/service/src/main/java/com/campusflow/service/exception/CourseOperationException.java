package com.campusflow.service.exception;

import lombok.Getter;

@Getter
public class CourseOperationException extends RuntimeException {
    private final int httpStatus;
    private final int code;
    private final String reason;

    public CourseOperationException(int httpStatus, int code, String message, String reason) {
        super(message);
        this.httpStatus = httpStatus;
        this.code = code;
        this.reason = reason;
    }
}
