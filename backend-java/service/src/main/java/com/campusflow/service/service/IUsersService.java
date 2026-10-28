package com.campusflow.service.service;

import com.campusflow.common.response.Result;
import com.campusflow.service.entity.po.Users;
import com.baomidou.mybatisplus.extension.service.IService;
import com.campusflow.service.entity.dto.loginDTO;
import com.campusflow.service.entity.dto.refreshDTO;
import com.campusflow.service.entity.vo.UserVo;

/**
 * <p>
 *  服务类
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
public interface IUsersService extends IService<Users> {

    Result login(loginDTO loginDTO);

    Result refresh(refreshDTO refreshDTO);

    Result<UserVo> getMe();

}
