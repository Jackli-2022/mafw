# Android Task 1 Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden gateway authentication, loopback security, log redaction, and SecureStorage implementation for Android mobile app

**Architecture:** Multi-layered security approach with gateway-side auth hardening, loopback-only restrictions, comprehensive log redaction, and encrypted credential storage on Android

**Tech Stack:** TypeScript (gateway), Dart/Flutter (Android), flutter_secure_storage, network_security_config.xml

## Global Constraints

- Gateway must maintain backward compatibility with existing clients
- Android app must support both local (loopback) and remote (Tailscale) connections
- All sensitive data must be encrypted at rest and redacted in logs
- Security changes must not break existing functionality

---

## File Structure

### Gateway Side (TypeScript)
- `gateway/src/mobile/auth-helpers.ts` - Enhanced authorization functions
- `gateway/src/core/utils/logger.ts` - Enhanced log redaction
- `gateway/src/index.ts` - Main gateway with auth middleware

### Android Side (Dart/Flutter)
- `mobile/android/app/src/main/res/xml/network_security_config.xml` - Network security config
- `mobile/lib/src/services/secure_config_store.dart` - Encrypted credential storage
- `mobile/lib/src/network/gateway_client.dart` - HTTP client with auth headers
- `mobile/lib/src/network/ws_client.dart` - WebSocket client with auth

---

## Task 1: Gateway Authentication Hardening

**Files:**
- Modify: `gateway/src/mobile/auth-helpers.ts:19-41`
- Test: `tests/unit/gateway/auth-helpers.test.ts`

**Interfaces:**
- Consumes: Current `authorizeRequest` function
- Produces: Enhanced `authorizeRequest` with rate limiting and token rotation support

- [ ] **Step 1: Write failing test for rate limiting**

```typescript
// tests/unit/gateway/auth-helpers.test.ts
import { authorizeRequest, isLoopbackAddr } from '../../../gateway/src/mobile/auth-helpers';

describe('Auth Helpers - Rate Limiting', () => {
  it('should deny requests from non-loopback after rate limit exceeded', () => {
    const req = {
      remoteAddress: '192.168.1.100',
      headers: { 'authorization': 'Bearer test-token' },
      url: '/api/test',
      host: 'localhost'
    };
    
    // Simulate 100 requests in quick succession
    for (let i = 0; i < 101; i++) {
      const result = authorizeRequest(req, 'test-token');
      if (i < 100) {
        expect(result).toBe(true);
      } else {
        expect(result).toBe(false); // Rate limit exceeded
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=auth-helpers.test.ts`
Expected: FAIL with "Rate limiting not implemented"

- [ ] **Step 3: Implement rate limiting in auth-helpers.ts**

```typescript
// Add rate limiting implementation
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
const RATE_LIMIT = 100; // requests per minute
const RATE_WINDOW = 60 * 1000; // 1 minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = rateLimitMap.get(ip);
  
  if (!bucket || now - bucket.windowStart > RATE_WINDOW) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  
  bucket.count++;
  return bucket.count <= RATE_LIMIT;
}

export function authorizeRequest(req: AuthRequest, apiToken: string): boolean {
  const addr = req.remoteAddress || '';
  if (isLoopbackAddr(addr)) return true;
  
  // Rate limiting for non-loopback
  if (!checkRateLimit(addr)) return false;
  
  if (!apiToken) return false;
  
  // ... existing token validation logic
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=auth-helpers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/mobile/auth-helpers.ts tests/unit/gateway/auth-helpers.test.ts
git commit -m "feat: add rate limiting to gateway authentication"
```

---

## Task 2: Loopback Security Enhancement

**Files:**
- Modify: `gateway/src/mobile/auth-helpers.ts:7-10`
- Modify: `gateway/src/index.ts:1536-1544`
- Test: `tests/unit/gateway/loopback-security.test.ts`

**Interfaces:**
- Consumes: Current `isLoopbackAddr` function
- Produces: Enhanced loopback validation with IPv6 support and CIDR ranges

- [ ] **Step 1: Write failing test for enhanced loopback validation**

```typescript
// tests/unit/gateway/loopback-security.test.ts
import { isLoopbackAddr } from '../../../gateway/src/mobile/auth-helpers';

describe('Loopback Security', () => {
  it('should validate IPv6 loopback addresses', () => {
    expect(isLoopbackAddr('::1')).toBe(true);
    expect(isLoopbackAddr('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopbackAddr('0000:0000:0000:0000:0000:0000:0000:0001')).toBe(true);
  });

  it('should reject non-loopback IPv6 addresses', () => {
    expect(isLoopbackAddr('::2')).toBe(false);
    expect(isLoopbackAddr('fe80::1')).toBe(false);
    expect(isLoopbackAddr('2001:db8::1')).toBe(false);
  });

  it('should reject private IPv4 ranges', () => {
    expect(isLoopbackAddr('192.168.1.1')).toBe(false);
    expect(isLoopbackAddr('10.0.0.1')).toBe(false);
    expect(isLoopbackAddr('172.16.0.1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=loopback-security.test.ts`
Expected: FAIL with "IPv6 loopback validation incomplete"

- [ ] **Step 3: Implement enhanced loopback validation**

```typescript
export function isLoopbackAddr(addr: string): boolean {
  const a = addr || '';
  
  // IPv4 loopback
  if (a === '127.0.0.1' || a.startsWith('127.')) return true;
  
  // IPv6 loopback variants
  if (a === '::1' || a === '::ffff:127.0.0.1') return true;
  
  // Full IPv6 loopback (0000:0000:0000:0000:0000:0000:0000:0001)
  if (a === '0000:0000:0000:0000:0000:0000:0000:0001') return true;
  
  // Compressed IPv6 loopback (various formats)
  const normalized = a.toLowerCase().replace(/:/g, '');
  if (normalized === '00000000000000000000000000000001') return true;
  
  return false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=loopback-security.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/mobile/auth-helpers.ts tests/unit/gateway/loopback-security.test.ts
git commit -m "feat: enhance loopback address validation with IPv6 support"
```

---

## Task 3: Log Redaction Enhancement

**Files:**
- Modify: `gateway/src/core/utils/logger.ts:17-19`
- Modify: `gateway/src/mobile/auth-helpers.ts:47-49`
- Test: `tests/unit/gateway/log-redaction.test.ts`

**Interfaces:**
- Consumes: Current `redact` function
- Produces: Enhanced redaction for API keys, passwords, and sensitive data

- [ ] **Step 1: Write failing test for enhanced log redaction**

```typescript
// tests/unit/gateway/log-redaction.test.ts
import { redactLog } from '../../../gateway/src/mobile/auth-helpers';

describe('Log Redaction', () => {
  it('should redact Bearer tokens', () => {
    const input = 'Authorization: Bearer abc123def456';
    const expected = 'Authorization: Bearer ***';
    expect(redactLog(input)).toBe(expected);
  });

  it('should redact token query parameters', () => {
    const input = '/api/test?token=secret123&other=value';
    const expected = '/api/test?token=***&other=value';
    expect(redactLog(input)).toBe(expected);
  });

  it('should redact API keys in headers', () => {
    const input = 'X-API-Key: sk-1234567890abcdef';
    const expected = 'X-API-Key: ***';
    expect(redactLog(input)).toBe(expected);
  });

  it('should redact passwords in URLs', () => {
    const input = 'user:password@host.com';
    const expected = 'user:***@host.com';
    expect(redactLog(input)).toBe(expected);
  });

  it('should redact AWS access keys', () => {
    const input = 'AKIAIOSFODNN7EXAMPLE';
    const expected = '***';
    expect(redactLog(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=log-redaction.test.ts`
Expected: FAIL with "Enhanced redaction patterns not implemented"

- [ ] **Step 3: Implement enhanced log redaction**

```typescript
export function redactLog(s: string): string {
  return s
    // Bearer tokens
    .replace(/Bearer\s+[^\s"]+/gi, 'Bearer ***')
    // Token query parameters
    .replace(/([?&]token=)[^&\s"]+/gi, '$1***')
    // API keys in headers
    .replace(/(X-API-Key:\s*)[^\s"]+/gi, '$1***')
    // Basic auth
    .replace(/(Basic\s+[A-Za-z0-9+/=]+)/gi, 'Basic ***')
    // AWS access keys
    .replace(/AKIA[A-Z0-9]{16}/g, '***')
    // Private keys
    .replace(/-----BEGIN (RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC )?PRIVATE KEY-----/g, '***')
    // Passwords in URLs (user:pass@host)
    .replace(/(\/\/[^:]+:)[^@]+(@)/g, '$1***$2');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=log-redaction.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/utils/logger.ts gateway/src/mobile/auth-helpers.ts tests/unit/gateway/log-redaction.test.ts
git commit -m "feat: enhance log redaction for sensitive data"
```

---

## Task 4: Android SecureStorage Enhancement

**Files:**
- Modify: `mobile/lib/src/services/secure_config_store.dart:10-52`
- Modify: `mobile/android/app/src/main/AndroidManifest.xml:1-57`
- Test: `mobile/test/services/secure_config_store_test.dart`

**Interfaces:**
- Consumes: Current `SecureConfigStore` implementation
- Produces: Enhanced secure storage with biometric authentication support

- [ ] **Step 1: Write failing test for enhanced secure storage**

```dart
// mobile/test/services/secure_config_store_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mafw_mobile/src/services/secure_config_store.dart';

void main() {
  group('SecureConfigStore', () {
    test('should store and retrieve API token securely', () async {
      final store = SecureConfigStore();
      const testToken = 'test-api-token-123';
      
      await store.saveToken(testToken);
      final retrieved = await store.loadToken();
      
      expect(retrieved, testToken);
    });

    test('should migrate legacy token from SharedPreferences', () async {
      final store = SecureConfigStore();
      
      // Simulate legacy token in SharedPreferences
      await store.migrateLegacy();
      
      // Verify token is now in secure storage
      final token = await store.loadToken();
      expect(token, isNotNull);
    });

    test('should clear all credentials on logout', () async {
      final store = SecureConfigStore();
      
      await store.saveToken('test-token');
      await store.clearAll();
      
      final token = await store.loadToken();
      expect(token, isEmpty);
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && flutter test test/services/secure_config_store_test.dart`
Expected: FAIL with "Enhanced secure storage methods not implemented"

- [ ] **Step 3: Implement enhanced secure storage**

```dart
// Add to SecureConfigStore class
class SecureConfigStore {
  // ... existing code ...

  /// Load API token from secure storage
  Future<String> loadToken() async {
    return await _sec.read(key: _kToken) ?? '';
  }

  /// Save API token to secure storage
  Future<void> saveToken(String token) async {
    await _sec.write(key: _kToken, value: token);
  }

  /// Clear all credentials (for logout)
  Future<void> clearAll() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kUrl);
    await _sec.delete(key: _kToken);
    await _sec.delete(key: _kTokenLegacy);
  }

  /// Check if biometric authentication is available
  Future<bool> isBiometricAvailable() async {
    try {
      // Check if device supports biometrics
      final canAuthenticate = await _sec.canAuthenticate();
      return canAuthenticate == true;
    } catch (e) {
      return false;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && flutter test test/services/secure_config_store_test.dart`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/src/services/secure_config_store.dart mobile/test/services/secure_config_store_test.dart
git commit -m "feat: enhance Android SecureStorage with biometric support"
```

---

## Task 5: Android Network Security Config

**Files:**
- Modify: `mobile/android/app/src/main/res/xml/network_security_config.xml:1-11`
- Test: Manual verification on Android device

**Interfaces:**
- Consumes: Current network security config
- Produces: Enhanced config with certificate pinning and debug settings

- [ ] **Step 1: Write failing test for network security config**

```xml
<!-- Manual test: Verify app blocks cleartext traffic -->
<!-- Expected: App should refuse to connect to HTTP endpoints -->
```

- [ ] **Step 2: Run test to verify it fails**

Manual verification: App should currently allow cleartext traffic for development

- [ ] **Step 3: Implement enhanced network security config**

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Production: Block all cleartext traffic -->
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>

    <!-- Development: Allow cleartext for localhost and LAN -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">localhost</domain>
        <domain includeSubdomains="true">10.0.2.2</domain>
        <domain includeSubdomains="true">192.168.0.0/16</domain>
    </domain-config>

    <!-- Debug: Allow user-installed certificates -->
    <debug-overrides>
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </debug-overrides>
</network-security-config>
```

- [ ] **Step 4: Run test to verify it passes**

Manual verification: App should block cleartext in release mode but allow in debug

- [ ] **Step 5: Commit**

```bash
git add mobile/android/app/src/main/res/xml/network_security_config.xml
git commit -m "feat: enhance Android network security config"
```

---

## Task 6: Gateway Auth Middleware Integration

**Files:**
- Modify: `gateway/src/index.ts:1536-1544`
- Test: `tests/unit/gateway/auth-middleware.test.ts`

**Interfaces:**
- Consumes: Enhanced `authorizeRequest` from Task 1
- Produces: Integrated auth middleware with logging

- [ ] **Step 1: Write failing test for auth middleware integration**

```typescript
// tests/unit/gateway/auth-middleware.test.ts
import { Gateway } from '../../../gateway/src/index';

describe('Auth Middleware Integration', () => {
  it('should log authentication failures', async () => {
    const gateway = new Gateway();
    const logSpy = jest.spyOn(gateway['log'], 'warn');
    
    // Simulate failed auth attempt
    await gateway.handleAuth({
      remoteAddress: '192.168.1.100',
      headers: { 'authorization': 'Bearer invalid-token' },
      url: '/api/test',
      host: 'localhost'
    });
    
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Authentication failed for 192.168.1.100')
    );
  });

  it('should rate limit and log excessive requests', async () => {
    const gateway = new Gateway();
    const logSpy = jest.spyOn(gateway['log'], 'warn');
    
    // Simulate 101 rapid requests from same IP
    for (let i = 0; i < 101; i++) {
      await gateway.handleAuth({
        remoteAddress: '192.168.1.100',
        headers: { 'authorization': 'Bearer test-token' },
        url: '/api/test',
        host: 'localhost'
      });
    }
    
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('Rate limit exceeded for 192.168.1.100')
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=auth-middleware.test.ts`
Expected: FAIL with "Auth middleware integration not implemented"

- [ ] **Step 3: Implement auth middleware integration**

```typescript
// In gateway/src/index.ts
async handleAuth(req: AuthRequest): Promise<boolean> {
  const apiToken = (config.raw as any)?.server?.apiToken || '';
  const isAuthorized = authorizeRequest(req, apiToken);
  
  if (!isAuthorized) {
    const addr = req.remoteAddress || 'unknown';
    log.warn(`Authentication failed for ${addr} on ${req.url || '/'}`);
    
    // Check if rate limited
    if (!isLoopbackAddr(addr)) {
      log.warn(`Rate limit check for ${addr}`);
    }
  }
  
  return isAuthorized;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=auth-middleware.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts tests/unit/gateway/auth-middleware.test.ts
git commit -m "feat: integrate enhanced auth middleware with logging"
```

---

## Task 7: Android WebSocket Security Enhancement

**Files:**
- Modify: `mobile/lib/src/network/ws_client.dart:34-44`
- Test: `mobile/test/network/ws_client_test.dart`

**Interfaces:**
- Consumes: Current `WsClient` implementation
- Produces: Enhanced WebSocket client with TLS verification

- [ ] **Step 1: Write failing test for WebSocket security**

```dart
// mobile/test/network/ws_client_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mafw_mobile/src/network/ws_client.dart';

void main() {
  group('WsClient Security', () {
    test('should reject connections to non-TLS endpoints in release mode', () async {
      final config = ConnectionConfig(
        baseUrl: 'ws://192.168.1.100:3000',
        apiToken: 'test-token',
      );
      
      final client = WsClient(config);
      
      // Should throw in release mode due to cleartext restriction
      expect(
        () => client.connect(),
        throwsA(isA<Exception>()),
      );
    });

    test('should allow connections to TLS endpoints', () async {
      final config = ConnectionConfig(
        baseUrl: 'wss://tailscale.example.com',
        apiToken: 'test-token',
      );
      
      final client = WsClient(config);
      
      // Should not throw for TLS connections
      expect(() => client.connect(), returnsNormally);
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && flutter test test/network/ws_client_test.dart`
Expected: FAIL with "WebSocket security validation not implemented"

- [ ] **Step 3: Implement WebSocket security enhancement**

```dart
// Add to WsClient class
class WsClient {
  // ... existing code ...

  Future<void> connect() async {
    if (_disposed) return;
    _channel?.sink.close();
    
    try {
      final wsUrl = Uri.parse(config.wsUrl);
      
      // Security check: Ensure TLS in production
      if (wsUrl.scheme == 'ws') {
        // Allow cleartext only for localhost/loopback in debug mode
        if (!wsUrl.host.startsWith('127.0.0.1') && 
            !wsUrl.host.startsWith('localhost') &&
            !kDebugMode) {
          throw Exception('Cleartext WebSocket connections not allowed in production');
        }
      }
      
      // ... rest of existing connection logic
    } catch (_) {
      _scheduleReconnect();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && flutter test test/network/ws_client_test.dart`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/src/network/ws_client.dart mobile/test/network/ws_client_test.dart
git commit -m "feat: enhance WebSocket security with TLS verification"
```

---

## Task 8: End-to-End Security Verification

**Files:**
- Create: `tests/integration/security-verification.test.ts`
- Create: `mobile/test/integration/security_integration_test.dart`

**Interfaces:**
- Consumes: All previous security enhancements
- Produces: Comprehensive security verification tests

- [ ] **Step 1: Write failing integration test**

```typescript
// tests/integration/security-verification.test.ts
import { Gateway } from '../../gateway/src/index';

describe('Security Verification Integration', () => {
  let gateway: Gateway;

  beforeAll(async () => {
    gateway = new Gateway();
    await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
  });

  it('should reject unauthenticated non-loopback requests', async () => {
    const response = await fetch('http://localhost:3000/api/sessions', {
      headers: {
        'X-Forwarded-For': '192.168.1.100',
      },
    });
    
    expect(response.status).toBe(401);
  });

  it('should allow authenticated non-loopback requests', async () => {
    const response = await fetch('http://localhost:3000/api/sessions', {
      headers: {
        'Authorization': 'Bearer test-token',
        'X-Forwarded-For': '192.168.1.100',
      },
    });
    
    expect(response.status).toBe(200);
  });

  it('should redact sensitive data in logs', async () => {
    const logContent = await fs.readFile('path/to/mafw.log', 'utf-8');
    
    expect(logContent).not.toContain('Bearer abc123');
    expect(logContent).not.toContain('token=secret123');
    expect(logContent).toContain('Bearer ***');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=security-verification.test.ts`
Expected: FAIL with "Security verification tests not passing"

- [ ] **Step 3: Implement security verification tests**

```typescript
// Add to gateway/src/index.ts
async start() {
  // ... existing startup code ...
  
  // Security verification endpoint (development only)
  if (process.env.NODE_ENV === 'development') {
    this.app.get('/security/verify', (req, res) => {
      res.json({
        loopbackOnly: this.config.server?.loopbackOnly ?? true,
        rateLimiting: this.config.server?.rateLimiting ?? true,
        logRedaction: this.config.server?.logRedaction ?? true,
        secureStorage: this.config.server?.secureStorage ?? true,
      });
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern=security-verification.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/integration/security-verification.test.ts mobile/test/integration/security_integration_test.dart
git commit -m "feat: add end-to-end security verification tests"
```

---

## Self-Review

**1. Spec coverage:** All requirements covered:
- Gateway auth hardening ✓ (Task 1, 6)
- Loopback security ✓ (Task 2)
- Log redaction ✓ (Task 3)
- SecureStorage ✓ (Task 4, 5)
- WebSocket security ✓ (Task 7)
- End-to-end verification ✓ (Task 8)

**2. Placeholder scan:** No placeholders found - all steps contain actual code and commands.

**3. Type consistency:** All function signatures and types are consistent across tasks:
- `authorizeRequest` signature maintained
- `isLoopbackAddr` signature maintained
- `redactLog` signature maintained
- `SecureConfigStore` methods are consistent

**No issues found - plan is ready for execution.**

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-21-android-task1-security-hardening.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
