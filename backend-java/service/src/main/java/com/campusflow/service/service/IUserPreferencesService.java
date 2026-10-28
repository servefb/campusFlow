package com.campusflow.service.service;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.UserPreferenceDto;
import com.campusflow.service.entity.po.UserPreferences;
import com.baomidou.mybatisplus.extension.service.IService;
import com.campusflow.service.entity.vo.UserPreferencesVo;

/**
 * <p>
 *  服务类
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
public interface IUserPreferencesService extends IService<UserPreferences> {

    Result<UserPreferencesVo> getPreferences();

    Result updatePreferences(UserPreferenceDto userPreferenceDto);

}
