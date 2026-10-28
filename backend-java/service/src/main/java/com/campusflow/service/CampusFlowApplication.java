package com.campusflow.service;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cache.annotation.EnableCaching;

@SpringBootApplication(scanBasePackages = "com.campusflow")
@MapperScan("com.campusflow.service.mapper")
@EnableCaching
public class CampusFlowApplication {
    public static void main(String[] args) { SpringApplication.run(CampusFlowApplication.class, args); }
}
