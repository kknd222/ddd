export default {
    SYSTEM_ERROR: [-1000, '系统异常'],
    SYSTEM_REQUEST_VALIDATION_ERROR: [-1001, '请求参数校验错误'],
    SYSTEM_NOT_ROUTE_MATCHING: [-1002, '无匹配的路由'],
    SYSTEM_TIMEOUT: [-1003, '请求超时'],
    SYSTEM_RATE_LIMIT: [-1004, '请求频率过高'],
    SYSTEM_MAINTENANCE: [-1005, '系统维护中'],
    SYSTEM_RESOURCE_EXHAUSTED: [-1006, '系统资源不足'],
    SYSTEM_DATABASE_ERROR: [-1007, '数据库异常'],
    SYSTEM_NETWORK_ERROR: [-1008, '网络异常'],
    SYSTEM_CONFIGURATION_ERROR: [-1009, '配置错误']
} as Record<string, [number, string]>