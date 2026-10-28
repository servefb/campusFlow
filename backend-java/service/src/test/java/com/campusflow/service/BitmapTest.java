package com.campusflow.service;

import com.campusflow.service.entity.po.*;
import com.campusflow.service.service.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@SpringBootTest
public class BitmapTest {

    @Autowired
    private ICourseSchedulesService courseSchedulesService;
    @Autowired
    private StringRedisTemplate stringRedisTemplate;
    @Autowired
    private IAcademicTermsService academicTermsService;
    @Autowired
    private ICoursePrerequisitesService coursePrerequisitesService;
    @Autowired
    private ICourseEnrollmentsService courseEnrollmentsService;

    @Autowired
    private ICourseOfferingsService courseOfferingsService;



    @Test
    void testBitmapText() {

        List<CourseSchedules> scheduleList = courseSchedulesService.lambdaQuery().list();
        AcademicTerms one = academicTermsService.lambdaQuery().eq(AcademicTerms::getIsCurrent, true).one();
        Integer maxWeek = one.getWeekCount();
        Integer periodsPerDay = one.getPeriodsPerDay();
        Integer daysPerWeek  = 7    ;
        Map<Long, List<CourseSchedules>> grouped = scheduleList.stream()
                .collect(Collectors.groupingBy(CourseSchedules::getOfferingId));

        int totalBits = maxWeek * periodsPerDay * daysPerWeek;
        int byteSize = (totalBits + 7) / 8; // 175 字节

        for (Map.Entry<Long, List<CourseSchedules>> entry : grouped.entrySet()) {
            byte[] mergedBitmap = new byte[byteSize];
            Long offeringId = entry.getKey();
            List<CourseSchedules> schedules = entry.getValue();
            for (CourseSchedules s : schedules) {
                byte[] singleBitmap = WeekRange.toMask(
                        s.getWeekRange(), s.getWeekday(), s.getStartPeriod(), s.getEndPeriod()
                );
                // 2. 合并位图
                for (int i = 0; i < mergedBitmap.length; i++) {
                    mergedBitmap[i] |= singleBitmap[i];
                }
            }
//             3. 用原生连接写入二进制，避免字符串序列化破坏数据
            String key = "campusflow:offering:bitmap:{"+one.getTermCode()+"}:" + offeringId;
            stringRedisTemplate.execute((RedisCallback<Void>) connection -> {
                connection.stringCommands().set(key.getBytes(), mergedBitmap);
                return null;
            });
            System.out.println("已写入位图: " + key);

        }
    }

    @Test
    void store() {
        AcademicTerms one = academicTermsService.lambdaQuery().eq(AcademicTerms::getIsCurrent, true).one();
        Long id = one.getId();
        List<CourseOfferings> list = courseOfferingsService.lambdaQuery().eq(CourseOfferings::getTermId, id).list();
        list.forEach(co -> {
            stringRedisTemplate.opsForValue().set("campusflow:course:store:{"+one.getTermCode()+"}:" + co.getId(), String.valueOf(co.getCapacity()))  ;
            Integer flag=1;
            if (!co.getSelectionStatus().equals("open")){
                flag=0;
            }
            stringRedisTemplate.opsForValue().set("campusflow:course:status:{"+one.getTermCode()+"}:" + co.getId(), String.valueOf(flag))  ;
        });
    }

    @Test
    void test() {


        AcademicTerms one = academicTermsService.lambdaQuery().eq(AcademicTerms::getIsCurrent, true).one();
        List<CoursePrerequisites> list = coursePrerequisitesService.list();
        list.forEach(cp -> {
            stringRedisTemplate.opsForSet().add("campusflow:course:prerequisite:{"+one.getTermCode()+"}:" + cp.getCourseId(), String.valueOf(cp.getPrerequisiteCourseId()))  ;
        });

    }

    @Test
    void test2() {


    }
}