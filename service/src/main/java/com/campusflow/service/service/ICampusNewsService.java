package com.campusflow.service.service;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.GetNewsHome;
import com.campusflow.service.entity.dto.NewPageDto;
import com.campusflow.service.entity.po.CampusNews;
import com.baomidou.mybatisplus.extension.service.IService;

/**
 * <p>
 *  服务类
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
public interface ICampusNewsService extends IService<CampusNews> {

    Result getHomeNews(GetNewsHome getNewsHome);

    Result getNewsById(Long newsId);

    Result getNewsList(NewPageDto newPageDto);


    Result getNewsCategories();

    Result bookmarkNews(Long newsId);

    Result removeBookmark(Long newsId);
}
