import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding call models...\n");

  // Create a test user if not exists
  const user = await prisma.user.upsert({
    where: { email: "test-call@ko-lab.test" },
    update: {},
    create: {
      email: "test-call@ko-lab.test",
      name: "Test Call User",
    },
  });
  console.log(`✓ Test user created: ${user.id}`);

  // Create a CallRoom
  const callRoom = await prisma.callRoom.create({
    data: {
      livekitRoom: `test-room-${Date.now()}`,
      type: "VIDEO",
      status: "RINGING",
      initiatorId: user.id,
      participants: {
        create: [{ userId: user.id }],
      },
    },
    include: { participants: true },
  });
  console.log(`✓ CallRoom created: ${callRoom.id} (${callRoom.status})`);
  console.log(`  Participant count: ${callRoom.participants.length}`);

  // Update to ONGOING
  const updated = await prisma.callRoom.update({
    where: { id: callRoom.id },
    data: { status: "ONGOING" },
  });
  console.log(`✓ CallRoom status updated to: ${updated.status}`);

  // Mark participant as joined
  await prisma.callParticipant.updateMany({
    where: { callId: callRoom.id },
    data: { joinedAt: new Date() },
  });
  console.log(`✓ Participant joinedAt timestamp set`);

  // Create a CallRecording
  const recording = await prisma.callRecording.create({
    data: {
      callId: callRoom.id,
      resolution: "1080p",
      status: "COMPLETED",
      filePath: `recordings/${callRoom.id}/test.mp4`,
      fileSize: 1024 * 1024,
      durationMs: 60000,
      initiatedById: user.id,
    },
  });
  console.log(`✓ CallRecording created: ${recording.id} (${recording.resolution})`);

  // Create a PushSubscription
  const pushSub = await prisma.pushSubscription.create({
    data: {
      userId: user.id,
      endpoint: "https://example.com/push/test",
      p256dh: "test-public-key",
      auth: "test-auth-secret",
    },
  });
  console.log(`✓ PushSubscription created: ${pushSub.id}`);

  // Cleanup
  await prisma.callRecording.delete({ where: { id: recording.id } });
  await prisma.callRoom.delete({ where: { id: callRoom.id } });
  await prisma.pushSubscription.delete({ where: { id: pushSub.id } });
  await prisma.user.delete({ where: { id: user.id } });

  console.log("\n✓ Cleanup complete. All models verified successfully!");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
