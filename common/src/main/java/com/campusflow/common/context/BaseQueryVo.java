package com.campusflow.common.context;

import com.campusflow.common.response.Result;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Builder
@Data
@NoArgsConstructor
@AllArgsConstructor
public class BaseQueryVo<T>{

    private List<T> items;
    private Long total;
    private Integer page;
    private Integer page_size;
    private Boolean has_more;
}
