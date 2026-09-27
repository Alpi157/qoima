import { Center, Loader } from '@mantine/core'

/** Shown while a lazily loaded page chunk is downloading. */
export function PageLoader({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <Center h={fullScreen ? '100vh' : undefined} py={fullScreen ? undefined : 'xl'}>
      <Loader />
    </Center>
  )
}
