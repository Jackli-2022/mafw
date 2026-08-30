/// Structured error models for MAFW mobile app.
///
/// Addresses bottleneck #9: Unfriendly error messages.
/// Provides error classification, user-friendly messages, and recovery suggestions.
library;

/// Error types for classification.
enum ErrorType {
  /// Network connectivity issues (no internet, DNS failure, etc.)
  network,

  /// Authentication failures (invalid token, expired, etc.)
  authentication,

  /// Authorization failures (insufficient permissions)
  authorization,

  /// Server-side errors (5xx responses)
  server,

  /// Client-side validation errors (invalid input)
  validation,

  /// Timeout errors (request took too long)
  timeout,

  /// Rate limiting (too many requests)
  rateLimit,

  /// Unknown or uncategorized errors
  unknown,
}

/// Recovery actions users can take.
enum ErrorAction {
  /// Retry the failed operation
  retry,

  /// Reconfigure connection settings
  reconfigure,

  /// Re-authenticate (login again)
  reauthenticate,

  /// Check network connectivity
  checkNetwork,

  /// Contact support
  contactSupport,

  /// Update the app
  updateApp,

  /// No action needed (informational)
  none,
}

/// Structured error with type, message, and recovery suggestions.
class MafwError {
  /// Error type for classification.
  final ErrorType type;

  /// User-friendly error message.
  final String message;

  /// Detailed technical message (for logging).
  final String technicalMessage;

  /// Suggestion for how to fix the error.
  final String suggestion;

  /// Whether the operation can be retried.
  final bool retryable;

  /// Recommended recovery action.
  final ErrorAction action;

  /// Original error (for debugging).
  final dynamic originalError;

  /// HTTP status code (if applicable).
  final int? statusCode;

  /// Timestamp when error occurred.
  final DateTime timestamp;

  const MafwError({
    required this.type,
    required this.message,
    this.technicalMessage = '',
    this.suggestion = '',
    this.retryable = true,
    this.action = ErrorAction.retry,
    this.originalError,
    this.statusCode,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? const _UtcNow();

  /// Create from HTTP response.
  factory MafwError.fromHttpResponse(int statusCode, String body) {
    switch (statusCode) {
      case 400:
        return MafwError(
          type: ErrorType.validation,
          message: '请求格式错误',
          technicalMessage: 'HTTP 400: $body',
          suggestion: '请检查输入是否正确',
          retryable: false,
          action: ErrorAction.reconfigure,
          statusCode: statusCode,
        );
      case 401:
        return MafwError(
          type: ErrorType.authentication,
          message: '认证失败',
          technicalMessage: 'HTTP 401: $body',
          suggestion: '请检查 API Token 是否正确，或重新配对',
          retryable: false,
          action: ErrorAction.reauthenticate,
          statusCode: statusCode,
        );
      case 403:
        return MafwError(
          type: ErrorType.authorization,
          message: '权限不足',
          technicalMessage: 'HTTP 403: $body',
          suggestion: '请联系管理员授予相应权限',
          retryable: false,
          action: ErrorAction.contactSupport,
          statusCode: statusCode,
        );
      case 404:
        return MafwError(
          type: ErrorType.server,
          message: '资源不存在',
          technicalMessage: 'HTTP 404: $body',
          suggestion: '请检查资源 ID 是否正确',
          retryable: false,
          action: ErrorAction.none,
          statusCode: statusCode,
        );
      case 429:
        return MafwError(
          type: ErrorType.rateLimit,
          message: '请求过于频繁',
          technicalMessage: 'HTTP 429: $body',
          suggestion: '请稍后再试',
          retryable: true,
          action: ErrorAction.retry,
          statusCode: statusCode,
        );
      case 500:
        return MafwError(
          type: ErrorType.server,
          message: '服务器内部错误',
          technicalMessage: 'HTTP 500: $body',
          suggestion: '请稍后重试，或检查 Gateway 日志',
          retryable: true,
          action: ErrorAction.retry,
          statusCode: statusCode,
        );
      case 502:
      case 503:
        return MafwError(
          type: ErrorType.server,
          message: '服务暂时不可用',
          technicalMessage: 'HTTP $statusCode: $body',
          suggestion: '服务正在维护，请稍后再试',
          retryable: true,
          action: ErrorAction.retry,
          statusCode: statusCode,
        );
      default:
        return MafwError(
          type: ErrorType.unknown,
          message: '未知服务器错误',
          technicalMessage: 'HTTP $statusCode: $body',
          suggestion: '请稍后重试',
          retryable: true,
          action: ErrorAction.retry,
          statusCode: statusCode,
        );
    }
  }

  /// Create from network error.
  factory MafwError.fromNetworkError(dynamic error) {
    final message = error.toString().toLowerCase();

    if (message.contains('connection refused')) {
      return MafwError(
        type: ErrorType.network,
        message: '无法连接到服务器',
        technicalMessage: error.toString(),
        suggestion: '请检查 Gateway 是否运行，地址是否正确',
        retryable: true,
        action: ErrorAction.checkNetwork,
        originalError: error,
      );
    } else if (message.contains('connection timed out') ||
        message.contains('timeout')) {
      return MafwError(
        type: ErrorType.timeout,
        message: '连接超时',
        technicalMessage: error.toString(),
        suggestion: '请检查网络连接，或稍后重试',
        retryable: true,
        action: ErrorAction.checkNetwork,
        originalError: error,
      );
    } else if (message.contains('no internet') ||
        message.contains('network is unreachable')) {
      return MafwError(
        type: ErrorType.network,
        message: '无网络连接',
        technicalMessage: error.toString(),
        suggestion: '请检查 Wi-Fi 或移动数据是否开启',
        retryable: true,
        action: ErrorAction.checkNetwork,
        originalError: error,
      );
    } else if (message.contains('host lookup failed') ||
        message.contains('name resolution')) {
      return MafwError(
        type: ErrorType.network,
        message: '无法解析服务器地址',
        technicalMessage: error.toString(),
        suggestion: '请检查服务器地址是否正确',
        retryable: true,
        action: ErrorAction.reconfigure,
        originalError: error,
      );
    }

    return MafwError(
      type: ErrorType.network,
      message: '网络连接错误',
      technicalMessage: error.toString(),
      suggestion: '请检查网络连接',
      retryable: true,
      action: ErrorAction.checkNetwork,
      originalError: error,
    );
  }

  /// Create from WebSocket error.
  factory MafwError.fromWebSocketError(dynamic error) {
    final message = error.toString().toLowerCase();

    if (message.contains('connection closed')) {
      return MafwError(
        type: ErrorType.network,
        message: 'WebSocket 连接已断开',
        technicalMessage: error.toString(),
        suggestion: '正在尝试重新连接...',
        retryable: true,
        action: ErrorAction.retry,
        originalError: error,
      );
    }

    return MafwError(
      type: ErrorType.network,
      message: 'WebSocket 错误',
      technicalMessage: error.toString(),
      suggestion: '正在尝试重新连接...',
      retryable: true,
      action: ErrorAction.retry,
      originalError: error,
    );
  }

  /// Create from generic exception.
  factory MafwError.fromException(dynamic error) {
    if (error is MafwError) return error;

    return MafwError(
      type: ErrorType.unknown,
      message: '发生未知错误',
      technicalMessage: error.toString(),
      suggestion: '请稍后重试',
      retryable: true,
      action: ErrorAction.retry,
      originalError: error,
    );
  }

  @override
  String toString() => 'MafwError($type: $message)';

  /// Convert to JSON for logging.
  Map<String, dynamic> toJson() => {
        'type': type.name,
        'message': message,
        'technicalMessage': technicalMessage,
        'suggestion': suggestion,
        'retryable': retryable,
        'action': action.name,
        'statusCode': statusCode,
        'timestamp': timestamp.toIso8601String(),
      };
}

/// Helper class for UTC timestamps in const constructors.
class _UtcNow implements DateTime {
  const _UtcNow();

  @override
  dynamic noSuchMethod(Invocation invocation) {
    return DateTime.now().noSuchMethod(invocation);
  }
}

/// Error handler utility class.
class StructuredErrorHandler {
  /// Handle an error and return a structured MafwError.
  static MafwError handleError(dynamic error) {
    if (error is MafwError) return error;

    if (error is Exception) {
      return MafwError.fromException(error);
    }

    return MafwError(
      type: ErrorType.unknown,
      message: '发生未知错误',
      technicalMessage: error.toString(),
      suggestion: '请稍后重试',
      retryable: true,
      action: ErrorAction.retry,
      originalError: error,
    );
  }

  /// Check if error is retryable.
  static bool isRetryable(MafwError error) {
    return error.retryable;
  }

  /// Get recommended delay before retry.
  static Duration getRetryDelay(MafwError error, int attempt) {
    if (!error.retryable) return Duration.zero;

    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    final delaySeconds = min(pow(2, attempt).toInt(), 30);
    return Duration(seconds: delaySeconds);
  }

  /// Format error for user display.
  static String formatForUser(MafwError error) {
    final buffer = StringBuffer();
    buffer.writeln(error.message);

    if (error.suggestion.isNotEmpty) {
      buffer.writeln();
      buffer.writeln('建议：${error.suggestion}');
    }

    return buffer.toString();
  }

  /// Format error for logging.
  static String formatForLog(MafwError error) {
    final buffer = StringBuffer();
    buffer.writeln('[${error.type.name.toUpperCase()}] ${error.message}');
    buffer.writeln('Technical: ${error.technicalMessage}');
    buffer.writeln('Retryable: ${error.retryable}');
    buffer.writeln('Action: ${error.action.name}');
    if (error.statusCode != null) {
      buffer.writeln('Status: ${error.statusCode}');
    }
    buffer.writeln('Time: ${error.timestamp.toIso8601String()}');
    return buffer.toString();
  }
}

/// Example usage:
///
/// ```dart
/// try {
///   final response = await client.get('/api/sessions');
///   if (response.statusCode != 200) {
///     throw MafwError.fromHttpResponse(response.statusCode, response.body);
///   }
///   // Process response
/// } catch (e) {
///   final error = StructuredErrorHandler.handleError(e);
///   
///   // Show user-friendly message
///   ScaffoldMessenger.of(context).showSnackBar(
///     SnackBar(content: Text(StructuredErrorHandler.formatForUser(error))),
///   );
///   
///   // Log technical details
///   print(StructuredErrorHandler.formatForLog(error));
///   
///   // Retry if retryable
///   if (StructuredErrorHandler.isRetryable(error)) {
///     final delay = StructuredErrorHandler.getRetryDelay(error, attempt);
///     Timer(delay, () => retry());
///   }
/// }
/// ```