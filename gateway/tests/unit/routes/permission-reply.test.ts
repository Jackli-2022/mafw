import { Readable } from 'node:stream';
import { handlePermissionReplyById } from '../../../src/routes/permission';

function makeRes() {
  const res: any = { status: 0, body: '' };
  res.writeHead = (status: number) => { res.status = status; };
  res.end = (body: string) => { res.body = body; };
  return res;
}

function makeReq(body: any) {
  return Readable.from([JSON.stringify(body)]) as any;
}

describe('handlePermissionReplyById', () => {
  test('finds a request in a non-default directory and replies', async () => {
    // 桌面切换项目后 gateway 默认 location 不含目标审批；全局回复入口必须
    // 按目录回退链找到它，否则 UI 的「允许一次」永远是 404（live smoke 实证）。
    const runtime: any = {
      session: {
        permissionList: jest.fn(async (opts?: { directory?: string }) =>
          opts?.directory === 'C:/proj' ? [{ id: 'per_1', sessionID: 's1' }] : []),
        permissionReply: jest.fn(async () => true),
      },
    };
    const res = makeRes();
    await handlePermissionReplyById(makeReq({ reply: 'once' }), res, 'per_1', {
      runtime,
      access: { can: () => true } as any,
      appendRecord: () => {},
      directories: () => [undefined, 'C:/proj'],
    });

    expect(runtime.session.permissionList).toHaveBeenNthCalledWith(1, undefined);
    expect(runtime.session.permissionList).toHaveBeenNthCalledWith(2, { directory: 'C:/proj' });
    expect(runtime.session.permissionReply).toHaveBeenCalledWith('s1', 'per_1', 'once', undefined);
    expect(res.status).toBe(200);
  });

  test('404s when the request is not in any directory', async () => {
    const runtime: any = {
      session: {
        permissionList: jest.fn(async () => []),
        permissionReply: jest.fn(async () => true),
      },
    };
    const res = makeRes();
    await handlePermissionReplyById(makeReq({ reply: 'reject' }), res, 'per_missing', {
      runtime,
      access: { can: () => true } as any,
      directories: () => ['C:/a', 'C:/b'],
    });

    expect(runtime.session.permissionReply).not.toHaveBeenCalled();
    expect(res.status).toBe(404);
  });
});
