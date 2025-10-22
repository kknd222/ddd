import { describe, it, expect, beforeEach } from 'vitest';
import ExceptionHandler from '../ExceptionHandler.ts';
import Exception from '../Exception.ts';
import APIException from '../APIException.ts';
import EX from '../../consts/exceptions.ts';

describe('ExceptionHandler', () => {
    beforeEach(() => {
        // 清理状态
    });

    describe('createException', () => {
        it('should create exception with basic parameters', () => {
            const exception = ExceptionHandler.createException(EX.SYSTEM_ERROR, 'Test error');
            
            expect(exception).toBeInstanceOf(Exception);
            expect(exception.errcode).toBe(-1000);
            expect(exception.errmsg).toBe('Test error');
        });

        it('should create exception with context', () => {
            const context = { userId: '123', action: 'test' };
            const exception = ExceptionHandler.createException(EX.SYSTEM_ERROR, 'Test error', context);
            
            expect(exception.context).toEqual(context);
        });
    });

    describe('createAPIException', () => {
        it('should create API exception', () => {
            const exception = ExceptionHandler.createAPIException(EX.API_REQUEST_PARAMS_INVALID, 'Invalid params');
            
            expect(exception).toBeInstanceOf(APIException);
            expect(exception.errcode).toBe(-2000);
            expect(exception.errmsg).toBe('Invalid params');
        });
    });

    describe('safeAsync', () => {
        it('should return result for successful operation', async () => {
            const result = await ExceptionHandler.safeAsync(async () => 'success');
            expect(result).toBe('success');
        });

        it('should return fallback for failed operation', async () => {
            const result = await ExceptionHandler.safeAsync(
                async () => { throw new Error('test'); },
                'fallback'
            );
            expect(result).toBe('fallback');
        });

        it('should return undefined when no fallback provided', async () => {
            const result = await ExceptionHandler.safeAsync(
                async () => { throw new Error('test'); }
            );
            expect(result).toBeUndefined();
        });
    });

    describe('safeSync', () => {
        it('should return result for successful operation', () => {
            const result = ExceptionHandler.safeSync(() => 'success');
            expect(result).toBe('success');
        });

        it('should return fallback for failed operation', () => {
            const result = ExceptionHandler.safeSync(
                () => { throw new Error('test'); },
                'fallback'
            );
            expect(result).toBe('fallback');
        });
    });

    describe('retry', () => {
        it('should succeed on first attempt', async () => {
            let attempts = 0;
            const result = await ExceptionHandler.retry(async () => {
                attempts++;
                return 'success';
            });
            
            expect(result).toBe('success');
            expect(attempts).toBe(1);
        });

        it('should retry on failure and eventually succeed', async () => {
            let attempts = 0;
            const result = await ExceptionHandler.retry(async () => {
                attempts++;
                if (attempts < 3) {
                    throw new Error('temporary failure');
                }
                return 'success';
            });
            
            expect(result).toBe('success');
            expect(attempts).toBe(3);
        });

        it('should throw after max retries', async () => {
            await expect(ExceptionHandler.retry(async () => {
                throw new Error('permanent failure');
            }, 2)).rejects.toThrow('permanent failure');
        });
    });

    describe('wrapError', () => {
        it('should wrap Error instance', () => {
            const error = new Error('test error');
            const exception = ExceptionHandler.wrapError(error);
            
            expect(exception).toBeInstanceOf(Exception);
            expect(exception.errmsg).toBe('test error');
        });

        it('should preserve existing Exception', () => {
            const originalException = new Exception(EX.SYSTEM_ERROR, 'original');
            const wrapped = ExceptionHandler.wrapError(originalException);
            
            expect(wrapped).toBe(originalException);
        });

        it('should wrap string as error', () => {
            const exception = ExceptionHandler.wrapError('string error');
            
            expect(exception).toBeInstanceOf(Exception);
            expect(exception.errmsg).toBe('string error');
        });
    });

    describe('assert', () => {
        it('should not throw for truthy condition', () => {
            expect(() => {
                ExceptionHandler.assert(true, EX.SYSTEM_ERROR);
            }).not.toThrow();
        });

        it('should throw for falsy condition', () => {
            expect(() => {
                ExceptionHandler.assert(false, EX.SYSTEM_ERROR, 'assertion failed');
            }).toThrow();
        });
    });

    describe('requireParam', () => {
        it('should not throw for valid parameter', () => {
            expect(() => {
                ExceptionHandler.requireParam('value', 'paramName');
            }).not.toThrow();
        });

        it('should throw for null parameter', () => {
            expect(() => {
                ExceptionHandler.requireParam(null, 'paramName');
            }).toThrow();
        });

        it('should throw for undefined parameter', () => {
            expect(() => {
                ExceptionHandler.requireParam(undefined, 'paramName');
            }).toThrow();
        });
    });

    describe('requireType', () => {
        it('should not throw for correct type', () => {
            expect(() => {
                ExceptionHandler.requireType('string', 'string', 'paramName');
            }).not.toThrow();
        });

        it('should throw for incorrect type', () => {
            expect(() => {
                ExceptionHandler.requireType('string', 'number', 'paramName');
            }).toThrow();
        });
    });
});
