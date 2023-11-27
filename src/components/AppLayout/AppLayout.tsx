import {
  Button,
  createStyles,
  useMantineTheme,
  Stack,
  Text,
  Title,
  Center,
  ThemeIcon,
  Affix,
  Box,
} from '@mantine/core';
import { IconBan } from '@tabler/icons-react';
import { signOut } from 'next-auth/react';

import React, { ComponentType, cloneElement } from 'react';
import { AppFooter } from '~/components/AppLayout/AppFooter';
import { AppHeader, RenderSearchComponentProps } from '~/components/AppLayout/AppHeader';
import { AssistantButton } from '~/components/Assistant/AssistantButton';
import { ScrollArea } from '~/components/ScrollArea/ScrollArea';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useFeatureFlags } from '~/providers/FeatureFlagsProvider';
import { GenerationSidebar } from '~/components/ImageGeneration/GenerationSidebar';
import { NodeProvider } from '~/components/NodeProvider/NodeProvider';

type AppLayoutProps = {
  innerLayout?: (page: React.ReactNode) => React.ReactNode;
  pageClass?: string;
  pageStyle?: React.CSSProperties;
};

export function AppLayout({
  children,
  innerLayout,
  pageClass,
  pageStyle,
  renderSearchComponent,
}: {
  children: React.ReactNode;
  renderSearchComponent?: (opts: RenderSearchComponentProps) => React.ReactElement;
} & AppLayoutProps) {
  const theme = useMantineTheme();
  const { classes, cx } = useStyles();
  const user = useCurrentUser();
  const isBanned = !!user?.bannedAt;
  const flags = useFeatureFlags();

  if (isBanned)
    return (
      <Center py="xl">
        <Stack align="center">
          <ThemeIcon size={128} radius={100} color="red">
            <IconBan size={80} />
          </ThemeIcon>
          <Title order={1} align="center">
            You have been banned
          </Title>
          <Text size="lg" align="center">
            This account has been banned and cannot access the site
          </Text>
          <Button onClick={() => signOut()}>Sign out</Button>
        </Stack>
      </Center>
    );

  const content = innerLayout ? innerLayout(children) : children;

  return (
    <NodeProvider className={cx(`theme-${theme.colorScheme}`, classes.root)}>
      <AppHeader fixed={false} renderSearchComponent={renderSearchComponent} />
      <div className={classes.wrapper}>
        <GenerationSidebar />
        <div className={classes.content}>
          <main className={classes.main}>
            {pageClass ? (
              <div className={pageClass} style={pageStyle}>
                {content}
              </div>
            ) : (
              <ScrollArea style={pageStyle} py="md">
                {content}
              </ScrollArea>
            )}
            {flags.assistant && (
              <div className={classes.assistant}>
                <AssistantButton />
              </div>
            )}
          </main>
          <AppFooter fixed={false} />
        </div>
      </div>
    </NodeProvider>
  );
}

const useStyles = createStyles((theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    flex: 1,
    overflow: 'hidden',
  },
  wrapper: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    containerName: 'main',
    containerType: 'inline-size',
    position: 'relative',
  },
  assistant: {
    position: 'absolute',
    bottom: 8,
    right: 12,
  },
}));

export function setPageOptions(Component: () => JSX.Element, options?: AppLayoutProps) {
  (Component as any).options = options;
}
