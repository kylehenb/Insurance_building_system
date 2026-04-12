export default async function QuotePrintPage({
  params,
}: {
  params: Promise<{ quoteId: string }>
}) {
  const { quoteId } = await params

  return (
    <div className="min-h-screen bg-white p-8">
      <h1>Quote Print Page</h1>
      <p>Quote ID: {quoteId}</p>
      <p>If you see this, the route works. Now adding data fetching...</p>
    </div>
  )
}
