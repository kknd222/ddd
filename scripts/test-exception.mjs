import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// 简单的测试框架
class TestRunner {
    constructor() {
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
    }

    test(name, fn) {
        this.tests.push({ name, fn });
    }

    async run() {
        console.log('🧪 开始异常处理测试...\n');
        
        for (const test of this.tests) {
            try {
                await test.fn();
                console.log(`✅ ${test.name}`);
                this.passed++;
            } catch (error) {
                console.log(`❌ ${test.name}: ${error.message}`);
                this.failed++;
            }
        }
        
        console.log(`\n📊 测试结果: ${this.passed} 通过, ${this.failed} 失败`);
        return this.failed === 0;
    }
}

const runner = new TestRunner();

// 全局 Exception 类定义
class Exception extends Error {
    constructor(exception, message, context) {
        super(message || exception[1]);
        this.errcode = exception[0];
        this.errmsg = message || exception[1];
        this.type = this.constructor.name;
        this.timestamp = Date.now();
        this.context = context || {};
    }
    
    isRetryable() {
        const retryableCodes = [-2001, -2007, -2008];
        return retryableCodes.includes(this.errcode);
    }
    
    isClientError() {
        return this.errcode >= -2000 && this.errcode < -1000;
    }
    
    isSystemError() {
        return this.errcode >= -1000;
    }
}

// 测试异常创建
runner.test('Exception 创建测试', () => {
    const EX = {
        SYSTEM_ERROR: [-1000, '系统异常'],
        API_REQUEST_PARAMS_INVALID: [-2000, '请求参数非法']
    };
    
    const exception = new Exception(EX.SYSTEM_ERROR, '测试错误', { userId: '123' });
    
    if (exception.errcode !== -1000) throw new Error('错误码不正确');
    if (exception.errmsg !== '测试错误') throw new Error('错误消息不正确');
    if (exception.context.userId !== '123') throw new Error('上下文信息不正确');
    if (!exception.isSystemError()) throw new Error('系统错误判断不正确');
    if (exception.isClientError()) throw new Error('客户端错误判断不正确');
});

// 测试异常处理工具
runner.test('ExceptionHandler 工具测试', async () => {
    // 模拟 ExceptionHandler
    class ExceptionHandler {
        static createException(exception, message, context) {
            return new Exception(exception, message, context);
        }
        
        static async safeAsync(operation, fallback) {
            try {
                return await operation();
            } catch (error) {
                console.log('Safe async caught error:', error.message);
                return fallback;
            }
        }
        
        static safeSync(operation, fallback) {
            try {
                return operation();
            } catch (error) {
                console.log('Safe sync caught error:', error.message);
                return fallback;
            }
        }
    }
    
    // 测试安全异步操作
    const result1 = await ExceptionHandler.safeAsync(async () => 'success');
    if (result1 !== 'success') throw new Error('安全异步操作失败');
    
    const result2 = await ExceptionHandler.safeAsync(async () => { throw new Error('test'); }, 'fallback');
    if (result2 !== 'fallback') throw new Error('安全异步回退失败');
    
    // 测试安全同步操作
    const result3 = ExceptionHandler.safeSync(() => 'success');
    if (result3 !== 'success') throw new Error('安全同步操作失败');
    
    const result4 = ExceptionHandler.safeSync(() => { throw new Error('test'); }, 'fallback');
    if (result4 !== 'fallback') throw new Error('安全同步回退失败');
});

// 测试异常监控
runner.test('ExceptionMonitor 监控测试', () => {
    // 模拟 ExceptionMonitor
    class ExceptionMonitor {
        constructor() {
            this.errorStats = new Map();
        }
        
        recordException(exception) {
            const errcode = exception.errcode;
            const now = Date.now();
            
            if (!this.errorStats.has(errcode)) {
                this.errorStats.set(errcode, {
                    count: 0,
                    lastOccurred: now,
                    samples: []
                });
            }
            
            const stats = this.errorStats.get(errcode);
            stats.count++;
            stats.lastOccurred = now;
        }
        
        getErrorStats(errcode) {
            if (errcode) {
                return this.errorStats.get(errcode) || null;
            }
            return Array.from(this.errorStats.entries()).map(([code, stats]) => ({
                errcode: code,
                count: stats.count,
                lastOccurred: stats.lastOccurred
            }));
        }
    }
    
    const monitor = new ExceptionMonitor();
    const EX = { SYSTEM_ERROR: [-1000, '系统异常'] };
    
    // 记录异常 - 使用之前定义的 Exception 类
    const exception = new Exception(EX.SYSTEM_ERROR, '测试错误');
    monitor.recordException(exception);
    
    const stats = monitor.getErrorStats(-1000);
    if (!stats) throw new Error('异常统计记录失败');
    if (stats.count !== 1) throw new Error('异常计数不正确');
});

// 运行测试
runner.run().then(success => {
    if (success) {
        console.log('\n🎉 所有异常处理测试通过！');
        process.exit(0);
    } else {
        console.log('\n💥 部分测试失败！');
        process.exit(1);
    }
}).catch(error => {
    console.error('测试运行失败:', error);
    process.exit(1);
});
