import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { Empty, SectionTitle, Table, Th } from "@/components/hearth/ui";
import { CreateUserForm, UserRow, type RestaurantOption } from "./UserForms";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await requireAdmin();

  const [users, restaurants] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: { restaurant: { select: { name: true } } },
    }),
    prisma.restaurant.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true },
    }),
  ]);

  const options: RestaurantOption[] = restaurants;

  return (
    <>
      <SectionTitle
        title="Users"
        subtitle="Staff accounts and what each one can reach. Admins see the whole platform; owners see exactly one restaurant."
      />

      <div className="mb-6">
        <CreateUserForm restaurants={options} />
      </div>

      {users.length === 0 ? (
        <Empty title="No users yet" body="Create the first admin account." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Role</Th>
              <Th>Scope</Th>
              <Th className="text-right">Manage</Th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow
                key={u.id}
                restaurants={options}
                user={{
                  id: u.id,
                  email: u.email,
                  name: u.name,
                  role: u.role,
                  restaurantId: u.restaurantId,
                  restaurantName: u.restaurant?.name ?? null,
                  createdAt: u.createdAt.toISOString(),
                  isSelf: u.id === session.userId,
                }}
              />
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
