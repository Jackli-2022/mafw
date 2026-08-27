import * as http from 'http';
import { log } from '../core/utils/logger';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const MODALITIES = ['image', 'video', 'audio'] as const;

export interface MediaSwitchDeps {
  persist: (overrides: Record<string, any>) => { changed: string[] };
  reloadPlugins: () => Promise<void>;
  /** Known engine names (plugin names; 'pi' is always implicitly available). */
  availableEngines: () => string[];
  /** Current effective media config (read AFTER persist — reflects the new state). */
  currentMedia: () => {
    engine?: string;
    image?: { engine?: string };
    video?: { engine?: string };
    audio?: { engine?: string };
  };
}

export async function handleMediaSwitch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: MediaSwitchDeps,
): Promise<void> {
  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err: any) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
    return;
  }

  const available = [...deps.availableEngines(), 'pi'];
  const validateEngine = (engine: string | undefined): string | null => {
    if (!engine || engine === 'pi') return 'pi';
    if (available.includes(engine)) return engine;
    return null;
  };

  const mediaUpdate: Record<string, any> = {};

  if (body.engine !== undefined) {
    const validated = validateEngine(body.engine);
    if (validated === null) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Media engine '${body.engine}' not found`, available }));
      return;
    }
    mediaUpdate.engine = validated;
  }

  for (const modality of MODALITIES) {
    if (body[modality]?.engine !== undefined) {
      const validated = validateEngine(body[modality].engine);
      if (validated === null) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Media engine '${body[modality].engine}' not found for ${modality}`, available }));
        return;
      }
      mediaUpdate[modality] = { engine: validated };
    }
  }

  if (Object.keys(mediaUpdate).length === 0) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No engine specified' }));
    return;
  }

  try {
    deps.persist({ media: mediaUpdate });
    await deps.reloadPlugins();
    log.info(`[Media] switched engine: ${JSON.stringify(mediaUpdate)}`);

    const cur = deps.currentMedia();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      media: {
        engine: cur.engine,
        image: cur.image,
        video: cur.video,
        audio: cur.audio,
      },
    }));
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}