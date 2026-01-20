import { run } from '@openai/agents';
import agent from './agent';
import telemetry, { latitudeProcessor } from './telemetry';

async function main() {
  await telemetry.capture({
    projectId: Number(process.env.LATITUDE_PROJECT_ID),
    path: 'agent',
    versionUuid: process.env.LATITUDE_VERSION_UUID as string,
  }, async (ctx) => {
    latitudeProcessor.setContext(ctx);

    const response = await run(agent, 'Talk to me about Spain, and include some history facts. You must use your tool to get history facts.');
    console.log(response.finalOutput);

    await latitudeProcessor.forceFlush();
    latitudeProcessor.clearContext();
  })
}

await main().catch(console.error);