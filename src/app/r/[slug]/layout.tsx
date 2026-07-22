import RegisterSW from "@/components/customer/RegisterSW";

export default function StoreLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { slug: string };
}) {
  return (
    <>
      <RegisterSW scope={`/r/${params.slug}`} />
      {children}
    </>
  );
}
