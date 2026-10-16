package com.campusflow.service.service.impl;

import com.campusflow.common.context.UserContext;
import com.campusflow.common.response.Result;
import com.campusflow.service.entity.dto.UserPreferenceDto;
import com.campusflow.service.entity.po.UserPreferences;
import com.campusflow.service.entity.vo.UserPreferencesVo;
import com.campusflow.service.mapper.UserPreferencesMapper;
import com.campusflow.service.service.IUserPreferencesService;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.stereotype.Service;

/**
 * <p>
 * 服务实现类
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@Service
public class UserPreferencesServiceImpl extends ServiceImpl<UserPreferencesMapper, UserPreferences> implements IUserPreferencesService {

    @Override
    public Result<UserPreferencesVo> getPreferences() {
        Long userId = UserContext.getUserId();
        UserPreferences one = lambdaQuery().eq(UserPreferences::getUserId, userId).one();
        if (one == null) {
            throw new IllegalArgumentException("User preferences not found");
        }
        UserPreferencesVo userPreferencesVo = new UserPreferencesVo();
        userPreferencesVo.setDefault_agent_mode(one.getDefaultAgentMode());
        userPreferencesVo.setAnswer_length(one.getAnswerLength());
        userPreferencesVo.setShow_citations(one.getShowCitations());
        userPreferencesVo.setTask_notifications(one.getTaskNotifications());
        userPreferencesVo.setKnowledge_notifications(one.getKnowledgeNotifications());
        userPreferencesVo.setHistory_retention_days(one.getHistoryRetentionDays());
        return new Result<UserPreferencesVo>().success(userPreferencesVo);
    }

    @Override
    public Result updatePreferences(UserPreferenceDto userPreferenceDto) {
        Long userId = UserContext.getUserId();
        UserPreferences one = lambdaQuery().eq(UserPreferences::getUserId, userId).one();
        if (one == null) {
            throw new IllegalArgumentException("User preferences not found");
        }
        one.setDefaultAgentMode(userPreferenceDto.getDefault_agent_mode());
        one.setAnswerLength(userPreferenceDto.getAnswer_length());
        one.setShowCitations(userPreferenceDto.getShow_citations());
        one.setTaskNotifications(userPreferenceDto.getTask_notifications());
        one.setKnowledgeNotifications(userPreferenceDto.getKnowledge_notifications());
        one.setHistoryRetentionDays(userPreferenceDto.getHistory_retention_days());
        updateById(one);

        return new Result(0,"偏好已保存",userPreferenceDto);
    }
}
