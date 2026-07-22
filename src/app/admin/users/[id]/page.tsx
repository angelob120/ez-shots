import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { userActivity } from "@/lib/activity";
import { SectionTitle, Stat, Card, Badge, Table, Th, Td, Empty } from "@/components/hearth/ui";
import { OperatorActivityTables, formatDuration } from "@/components/hearth/OperatorActivity";
import { UserManagePanel, type RestaurantOption } from "../UserForms";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

/**
 * One operator's page: their login history and in-app activity, plus the manage
 * controls (role, restaurant, password, delete). The name in the users list
 * links here — it's the single place to answer "who is this, what have they
 * been doing, and change their access", rather than reading it in one screen
 * and editing it in another.
 */
export default async function UserDetailPage({ params }: { params: { id: string } }) {
  const session = await requireAdmin();

  const [user, restaurants, activity] = await Promise.all([
    prisma.user.findUnique({
      where: { id: params.id },
      include: { restaurant: { select: { id: true, name: true } } },
    }),
    prisma.restaurant.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } }),
    userActivity(params.id, WINDOW_DAYS),
  ]);

  if (!user) notFound();

  const options: RestaurantOption[] = restaurants;
  const s = activity.summary;

  return (
    <>
      <div className="mb-2">
        <Link href="/admin/users" className="text-[13px] text-dim hover:text-ink">
          ← All users
        </Link>
      </div>

      <SectionTitle
        title={user.name || user.email}
        subtitle={user.name ? user.email : undefined}
      />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-[13px]">
        <Badge tone={user.role === "ADMIN" ? "good" : "neutral"}>
          {user.role === "ADMIN" ? "Admin" : "Owner"}
        </Badge>
        {user.restaurant ? (
          <Link
            href={`/admin/restaurants/${user.restaurant.id}?tab=analytics`}
            className="text-ink underline-offset-2 hover:text-accent hover:underline"
          >
            {user.restaurant.name}
          </Link>
        ) : (
          <span className="text-mute">Platform-wide</span>
        )}
        <span className="text-mute">· joined {user.createdAt.toLocaleDateString()}</span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Logins" value={String(s?.logins ?? 0)} hint={`in ${WINDOW_DAYS} days`} />
        <Stat label="Page loads" value={String(s?.pageViews ?? 0)} />
        <Stat label="Active time" value={formatDuration(s?.activeMs ?? 0)} />
        <Stat label="Last seen" value={s?.lastSeenAt ? timeAgo(s.lastSeenAt) : "—"} />
      </div>

      <div className="mb-8">
        <OperatorActivityTables
          summary={s ? [s] : []}
          logins={activity.logins}
          emptyBody="No sign-ins or activity for this user in the window — or migration 35_login_history hasn't run yet."
        />
      </div>

      <div className="mb-8">
        <div className="mb-3 text-[13px] font-medium text-ink">Most-used pages</div>
        {activity.topPaths.length === 0 ? (
          <Empty title="No pages recorded yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Page</Th>
                <Th className="text-right">Loads</Th>
              </tr>
            </thead>
            <tbody>
              {activity.topPaths.map((p) => (
                <tr key={p.path}>
                  <Td className="font-mono text-[12px]">{p.path}</Td>
                  <Td className="text-right font-mono tabular-nums">{p.count}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <div className="mb-3 text-[13px] font-medium text-ink">Manage</div>
      <Card>
        <UserManagePanel
          restaurants={options}
          user={{
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            restaurantId: user.restaurantId,
            restaurantName: user.restaurant?.name ?? null,
            createdAt: user.createdAt.toISOString(),
            isSelf: user.id === session.userId,
          }}
        />
      </Card>
    </>
  );
}

function timeAgo(d: Date): string {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
