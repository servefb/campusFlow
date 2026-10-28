package com.campusflow.service.service.impl;

import cn.hutool.json.JSON;
import cn.hutool.json.JSONUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.campusflow.common.constant.NewConstant;
import com.campusflow.common.context.BaseQueryVo;
import com.campusflow.common.context.UserContext;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.GetNewsHome;
import com.campusflow.service.entity.dto.NewPageDto;
import com.campusflow.service.entity.po.CampusNews;
import com.campusflow.service.entity.po.Files;
import com.campusflow.service.entity.po.NewsBookmarks;
import com.campusflow.service.entity.vo.GetHomeNewsVo;
import com.campusflow.service.mapper.CampusNewsMapper;
import com.campusflow.service.service.ICampusNewsService;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.campusflow.service.service.IFilesService;
import com.campusflow.service.service.INewsBookmarksService;
import lombok.AllArgsConstructor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.sql.SQLType;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;

/**
 * <p>
 * 服务实现类
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@Service
@AllArgsConstructor
public class CampusNewsServiceImpl extends ServiceImpl<CampusNewsMapper, CampusNews> implements ICampusNewsService {

    private INewsBookmarksService newsBookmarksService;
    private CampusNewsMapper campusNewsMapper;
    private StringRedisTemplate stringRedisTemplate;
    private IFilesService filesService;
    private MinioService minioService;

    private final String CAMPUS_NEWS_KEY = "campusflow:news:";

    @Override
    public Result<GetHomeNewsVo> getHomeNews(GetNewsHome getNewsHome) {

        if (getNewsHome == null) {
            throw new IllegalArgumentException("参数错误");
        }
        if (stringRedisTemplate.opsForValue().get(CAMPUS_NEWS_KEY + getNewsHome.getCategory()) != null) {
            String json = stringRedisTemplate.opsForValue().get(CAMPUS_NEWS_KEY + getNewsHome.getCategory());
            return new Result<GetHomeNewsVo>().success(JSONUtil.toBean(json, GetHomeNewsVo.class));
        }

        Long userId = UserContext.getUserId();

        List<Long> newsList = newsBookmarksService.lambdaQuery()
                .in(NewsBookmarks::getUserId, userId).list().stream()
                .map(NewsBookmarks::getNewsId).toList();

        Set<String> categorySet = lambdaQuery()
                .in(CampusNews::getId, newsList)
                .list().stream()
                .map(CampusNews::getCategory).collect(Collectors.toSet());


        List<CampusNews> homeList = lambdaQuery()
                .eq(!getNewsHome.getCategory().equals("all"),
                        CampusNews::getCategory, getNewsHome.getCategory())
                .like(getNewsHome.getQuery() != null,
                        CampusNews::getTitle, getNewsHome.getQuery())
                .eq(getNewsHome.getDepartment_id() != null,
                        CampusNews::getOrganizationId, getNewsHome.getDepartment_id())
                .eq(CampusNews::getIsSpotlight, NewConstant.NOISLIGHT)

                .notIn(getNewsHome.getFollowing(), CampusNews::getId, newsList)
                .orderBy(true, getNewsHome.getSort(), CampusNews::getPublishedAt).list();
        List<GetHomeNewsVo.RecommendNews> recommendNewsList = new ArrayList<>();
        List<CampusNews> recomList = lambdaQuery().in(!categorySet.isEmpty(), CampusNews::getCategory, categorySet).orderByDesc(CampusNews::getPublishedAt).last("limit 3").list();

        recomList.forEach(cns -> recommendNewsList.add(GetHomeNewsVo.toRecommendNews(cns, "与你关注的" + cns.getCategory() + "相关",null)));
        CampusNews campusNews = lambdaQuery().eq(CampusNews::getIsSpotlight, NewConstant.NEW_HOME)
                .orderByDesc(CampusNews::getPublishedAt)
                .list().get(0);


        LocalDateTime startOfDay = LocalDate.now().atStartOfDay();
        LocalDateTime endOfDay = LocalDate.now().atTime(LocalTime.MAX);


        String coverFileId = campusNews.getCoverFileId();
        Files files = filesService.getById(coverFileId);
        String presignedUrl = null;
        try {
            presignedUrl = minioService.getPresignedGetUrl(files.getObjectKey(), Duration.ofDays(7));
            presignedUrl = presignedUrl.split("\\?")[0];
        } catch (Exception e) {
            presignedUrl="图片路径获取失败";
        }
        GetHomeNewsVo getHomeNewsVo = GetHomeNewsVo.builder()
                .spotlight(GetHomeNewsVo.toRecommendNews(campusNews, null,presignedUrl))
                .recommendations(recommendNewsList)
                .groups(Map.of(
                        NewConstant.TODAY, new ArrayList<>(),
                        NewConstant.YESTERDAY, new ArrayList<>(),
                        NewConstant.DAY_OLD, new ArrayList<>()
                ))
                .build();
        homeList.forEach(cns -> {
            if (cns.getPublishedAt().isAfter(startOfDay) && cns.getPublishedAt().isBefore(endOfDay)) {
                getHomeNewsVo.getGroups().get(NewConstant.TODAY).add(cns);
            } else if (cns.getPublishedAt().isAfter(startOfDay.minusDays(1)) && cns.getPublishedAt().isBefore(endOfDay.minusDays(1))) {
                getHomeNewsVo.getGroups().get(NewConstant.YESTERDAY).add(cns);
            } else {
                getHomeNewsVo.getGroups().get(NewConstant.DAY_OLD).add(cns);
            }
        });

        List<GetHomeNewsVo.Categories> category = getCategories();
        getHomeNewsVo.setCategories(category);
        getHomeNewsVo.setFollowing_count(newsList.size());
        stringRedisTemplate.opsForValue().set(CAMPUS_NEWS_KEY + getNewsHome.getCategory(), JSONUtil.toJsonStr(getHomeNewsVo));
        stringRedisTemplate.expire(CAMPUS_NEWS_KEY + getNewsHome.getCategory(), 60 * 60 * 24, TimeUnit.DAYS);
        return new Result<GetHomeNewsVo>().success(getHomeNewsVo);


    }

    //todo 缺少ai智能推荐
    @Override
    public Result<CampusNews> getNewsById(Long newsId) {

        CampusNews byId = getById(newsId);
        if (byId == null) {
            throw new IllegalArgumentException("新闻不存在");
        }
        return new Result<CampusNews>().success(byId);

    }

    @Override
    public Result getNewsList(NewPageDto newPageDto) {

        if (newPageDto == null) {
            throw new IllegalArgumentException("参数错误");
        }
        Page<CampusNews> page = lambdaQuery().eq(CampusNews::getStatus, NewConstant.PUBLISHED)
                .eq(newPageDto.getCategory() != null, CampusNews::getCategory, newPageDto.getCategory())
                .eq(newPageDto.getQuery() != null, CampusNews::getTitle, newPageDto.getQuery())
                .orderByDesc(CampusNews::getPublishedAt)
                .page(new Page<>(newPageDto.getPage(), newPageDto.getPage_size()));

        if (page.getRecords().isEmpty()) {
            return new Result<Void>().success(null);
        }
        List<CampusNews> records = page.getRecords();
        BaseQueryVo<CampusNews> pageContext = new BaseQueryVo<>();
        pageContext.setPage(newPageDto.getPage());
        pageContext.setPage_size(newPageDto.getPage_size());
        pageContext.setTotal(page.getTotal());
        pageContext.setItems(records);
        pageContext.setHas_more(page.getTotal() > page.getSize() * page.getCurrent());

        return new Result<BaseQueryVo<CampusNews>>().success(pageContext);

    }

    @Override
    public Result getNewsCategories() {

        List<Map<String, Object>> category = campusNewsMapper.getCategory();
        if (category == null) {
            return new Result<Void>().success(null);
        }
        Map<String, List<Map<String, Object>>> newsCategoriesMap = new HashMap<>();
        newsCategoriesMap.put("item", category);
        return new Result<>().success(newsCategoriesMap);
    }

    @Override
    public Result bookmarkNews(Long newsId) {

        CampusNews byId = getById(newsId);
        if (byId == null) {
            throw new IllegalArgumentException("新闻不存在");
        }
        Long userId = UserContext.getUserId();
        boolean save = newsBookmarksService.save(NewsBookmarks.builder()
                .userId(userId)
                .newsId(newsId)
                .build());
        if (!save) {
            throw new RuntimeException("操作失败");
        }
        return new Result().success();
    }

    @Override
    public Result removeBookmark(Long newsId) {

        Long userId = UserContext.getUserId();
        boolean remove = newsBookmarksService.remove(new LambdaQueryWrapper<NewsBookmarks>().eq(NewsBookmarks::getUserId, userId).eq(NewsBookmarks::getNewsId, newsId));

        if (!remove) {
            throw new RuntimeException("操作失败");
        }
        return new Result().success();
    }

    private List<GetHomeNewsVo.Categories> getCategories() {
        List<Map<String, Object>> category = campusNewsMapper.getCategory();
        List<GetHomeNewsVo.Categories> objects = new ArrayList<>();
        category.forEach(categories -> {
            GetHomeNewsVo.Categories categoriesObj = GetHomeNewsVo.Categories.builder()
                    .name(categories.get("category").toString())
                    .count((Long) categories.get("count"))
                    .build();
            objects.add(categoriesObj);
        });
        return objects;
    }
}
