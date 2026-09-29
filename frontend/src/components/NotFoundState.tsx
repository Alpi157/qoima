import { type ReturnLinkProps, PageContainer, PageHeader } from './ui'

export interface NotFoundStateProps {
  title: string
  /** The way back to the list: «Тауарлар». */
  back: ReturnLinkProps
}

/** Shown by a detail page when the server answers 404. */
export function NotFoundState({ title, back }: NotFoundStateProps) {
  return (
    <PageContainer>
      <PageHeader back={back} title={title} />
    </PageContainer>
  )
}
