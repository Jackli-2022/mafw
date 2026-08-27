import { listByDirectory, mapPiSessionToGateway, type PiSessionInfo } from '../../../src/runtime/pi/pi-session-storage';

describe('pi-session-storage', () => {
  describe('mapPiSessionToGateway', () => {
    it('maps pi session to gateway format', () => {
      const piSession: PiSessionInfo = {
        path: '/home/user/.pi/agent/sessions/abc123/session.jsonl',
        id: 'abc123',
        cwd: '/home/user/project',
        name: 'Test Session',
        created: new Date('2024-01-01T00:00:00Z'),
        modified: new Date('2024-01-02T00:00:00Z'),
        messageCount: 10,
        firstMessage: 'Hello world',
      };

      const result = mapPiSessionToGateway(piSession);

      expect(result).toEqual({
        id: 'abc123',
        projectID: '/home/user/project',
        directory: '/home/user/project',
        title: 'Test Session',
        time: {
          created: 1704067200000,
          updated: 1704153600000,
        },
      });
    });

    it('uses firstMessage as title when name is missing', () => {
      const piSession: PiSessionInfo = {
        path: '/path/to/session.jsonl',
        id: 'xyz789',
        cwd: '/project',
        created: new Date('2024-01-01T00:00:00Z'),
        modified: new Date('2024-01-01T00:00:00Z'),
        messageCount: 5,
        firstMessage: 'First message content',
      };

      const result = mapPiSessionToGateway(piSession);

      expect(result.title).toBe('First message content');
    });

    it('uses id as title when both name and firstMessage are missing', () => {
      const piSession: PiSessionInfo = {
        path: '/path/to/session.jsonl',
        id: 'fallback-id',
        cwd: '/project',
        created: new Date('2024-01-01T00:00:00Z'),
        modified: new Date('2024-01-01T00:00:00Z'),
        messageCount: 0,
        firstMessage: '',
      };

      const result = mapPiSessionToGateway(piSession);

      expect(result.title).toBe('fallback-id');
    });

    it('handles missing dates gracefully', () => {
      const piSession: PiSessionInfo = {
        path: '/path/to/session.jsonl',
        id: 'test-id',
        cwd: '/project',
        created: null as any,
        modified: null as any,
        messageCount: 0,
        firstMessage: '',
      };

      const result = mapPiSessionToGateway(piSession);

      expect(result.time.created).toBe(0);
      expect(result.time.updated).toBe(0);
    });
  });

  describe('listByDirectory', () => {
    it('returns empty array when pi module is not available', async () => {
      const result = await listByDirectory('/project', undefined, null);
      expect(result).toEqual([]);
    });

    it('returns empty array when SessionManager is missing', async () => {
      const mockModule = {};
      const result = await listByDirectory('/project', undefined, mockModule);
      expect(result).toEqual([]);
    });

    it('calls SessionManager.list with directory', async () => {
      const mockSessions: PiSessionInfo[] = [
        {
          path: '/path/session1.jsonl',
          id: 'session1',
          cwd: '/project',
          name: 'Session 1',
          created: new Date('2024-01-01T00:00:00Z'),
          modified: new Date('2024-01-01T00:00:00Z'),
          messageCount: 5,
          firstMessage: 'Hello',
        },
      ];

      const mockModule = {
        SessionManager: {
          list: jest.fn().mockResolvedValue(mockSessions),
        },
      };

      const result = await listByDirectory('/project', undefined, mockModule);

      expect(mockModule.SessionManager.list).toHaveBeenCalledWith('/project');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('session1');
      expect(result[0].title).toBe('Session 1');
    });

    it('applies limit when provided', async () => {
      const mockSessions: PiSessionInfo[] = [
        {
          path: '/path/session1.jsonl',
          id: 'session1',
          cwd: '/project',
          name: 'Session 1',
          created: new Date('2024-01-01T00:00:00Z'),
          modified: new Date('2024-01-01T00:00:00Z'),
          messageCount: 5,
          firstMessage: 'Hello',
        },
        {
          path: '/path/session2.jsonl',
          id: 'session2',
          cwd: '/project',
          name: 'Session 2',
          created: new Date('2024-01-02T00:00:00Z'),
          modified: new Date('2024-01-02T00:00:00Z'),
          messageCount: 10,
          firstMessage: 'World',
        },
        {
          path: '/path/session3.jsonl',
          id: 'session3',
          cwd: '/project',
          name: 'Session 3',
          created: new Date('2024-01-03T00:00:00Z'),
          modified: new Date('2024-01-03T00:00:00Z'),
          messageCount: 15,
          firstMessage: 'Test',
        },
      ];

      const mockModule = {
        SessionManager: {
          list: jest.fn().mockResolvedValue(mockSessions),
        },
      };

      const result = await listByDirectory('/project', 2, mockModule);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('session1');
      expect(result[1].id).toBe('session2');
    });

    it('returns empty array on error', async () => {
      const mockModule = {
        SessionManager: {
          list: jest.fn().mockRejectedValue(new Error('Failed to list sessions')),
        },
      };

      const result = await listByDirectory('/project', undefined, mockModule);

      expect(result).toEqual([]);
    });

    it('maps all sessions to gateway format', async () => {
      const mockSessions: PiSessionInfo[] = [
        {
          path: '/path/session1.jsonl',
          id: 'session1',
          cwd: '/project',
          name: 'Session 1',
          created: new Date('2024-01-01T00:00:00Z'),
          modified: new Date('2024-01-01T00:00:00Z'),
          messageCount: 5,
          firstMessage: 'Hello',
        },
        {
          path: '/path/session2.jsonl',
          id: 'session2',
          cwd: '/project',
          created: new Date('2024-01-02T00:00:00Z'),
          modified: new Date('2024-01-02T00:00:00Z'),
          messageCount: 10,
          firstMessage: 'World',
        },
      ];

      const mockModule = {
        SessionManager: {
          list: jest.fn().mockResolvedValue(mockSessions),
        },
      };

      const result = await listByDirectory('/project', undefined, mockModule);

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'session1',
        projectID: '/project',
        directory: '/project',
        title: 'Session 1',
      });
      expect(result[1]).toMatchObject({
        id: 'session2',
        projectID: '/project',
        directory: '/project',
        title: 'World',
      });
    });
  });
});
