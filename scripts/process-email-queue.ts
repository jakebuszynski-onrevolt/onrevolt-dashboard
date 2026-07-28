import { closeSmtpConnection, processEmailQueue } from '../src/lib/onrevolt/email';
import { prisma } from '../src/lib/onrevolt/prisma';

async function main() {
  const results = await processEmailQueue(30);
  const sent = results.filter((item) => item.status === 'SENT').length;
  const queued = results.filter((item) => item.status === 'QUEUED').length;
  const failed = results.filter((item) => item.status === 'FAILED').length;
  console.log(JSON.stringify({ processed: results.length, sent, queued, failed }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    closeSmtpConnection();
    await prisma.$disconnect();
  });
