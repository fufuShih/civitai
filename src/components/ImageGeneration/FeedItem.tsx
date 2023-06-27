import {
  Paper,
  Checkbox,
  AspectRatio,
  Card,
  ActionIcon,
  Group,
  Transition,
  Tooltip,
  TooltipProps,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { ModelType } from '@prisma/client';
import {
  IconArrowsShuffle,
  IconBolt,
  IconInfoCircle,
  IconPlayerPlayFilled,
  IconWindowMaximize,
} from '@tabler/icons-react';
import { EdgeImage } from '~/components/EdgeImage/EdgeImage';
import { GeneratedImage } from '~/components/ImageGeneration/GeneratedImage';
import { useImageGenerationRequest } from '~/components/ImageGeneration/hooks/useImageGenerationState';
import { imageGenerationFormStorage } from '~/components/ImageGeneration/utils';
import { ImageMetaPopover } from '~/components/ImageMeta/ImageMeta';
import { constants } from '~/server/common/constants';
import { Generation } from '~/server/services/generation/generation.types';
import { useGenerationStore } from '~/store/generation.store';

const tooltipProps: Omit<TooltipProps, 'children' | 'label'> = {
  withinPortal: true,
  withArrow: true,
  color: 'dark',
  zIndex: constants.imageGeneration.drawerZIndex + 1,
};

/**
 * TODO.generation:
 * - add action to generate image with the same prompt (play icon)
 * - correctly type the image object
 */
export function FeedItem({ image, selected, onCheckboxClick, onCreateVariantClick }: Props) {
  const [opened, { toggle, close }] = useDisclosure();
  const request = useImageGenerationRequest(image.requestId);
  const setView = useGenerationStore((state) => state.setActiveTab);

  const handleGenerate = () => {
    imageGenerationFormStorage.set({
      model: request.resources.find((x) => x.modelType === ModelType.Checkpoint),
      additionalResources: request.resources.filter((x) => x.modelType !== ModelType.Checkpoint),
      ...request.params,
      aspectRatio: `${request.params.width}x${request.params.height}`,
    });
    setView('generate');
  };

  return (
    <Paper
      key={image.id}
      radius="sm"
      sx={(theme) => ({
        position: 'relative',
        // If the item is selected, we want to add an overlay to it
        '&::after': selected
          ? {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              backgroundColor: theme.fn.rgba(theme.colors.blue[theme.fn.primaryShade()], 0.3),
            }
          : undefined,
      })}
    >
      <AspectRatio ratio={1}>
        <GeneratedImage width={request.params.width} height={request.params.height} image={image} />
      </AspectRatio>
      <Checkbox
        sx={(theme) => ({
          position: 'absolute',
          top: theme.spacing.xs,
          left: theme.spacing.xs,
          zIndex: 3,
        })}
        checked={selected}
        onChange={(event) => {
          onCheckboxClick({ image, checked: event.target.checked });
          close();
        }}
      />
      {!selected && (
        <Group
          position="apart"
          sx={(theme) => ({
            bottom: 0,
            left: 0,
            padding: theme.spacing.xs,
            position: 'absolute',
            width: '100%',
            overflow: 'hidden',
            zIndex: 3,
          })}
        >
          <Card p={0} withBorder>
            <Group spacing={0} noWrap>
              <ActionIcon size="md" variant="light" p={4} onClick={toggle} radius={0}>
                <IconBolt />
              </ActionIcon>
              {opened && (
                <Group spacing={0} noWrap>
                  <Tooltip {...tooltipProps} label="Generate">
                    <ActionIcon size="md" p={4} variant="light" radius={0} onClick={handleGenerate}>
                      <IconPlayerPlayFilled />
                    </ActionIcon>
                  </Tooltip>

                  <Tooltip {...tooltipProps} label="Create variant">
                    <ActionIcon
                      size="md"
                      p={4}
                      variant="light"
                      onClick={() => onCreateVariantClick(image)}
                      radius={0}
                      disabled
                    >
                      <IconArrowsShuffle />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip {...tooltipProps} label="Upscale">
                    <ActionIcon size="md" p={4} variant="light" radius={0} disabled>
                      <IconWindowMaximize />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              )}
            </Group>
          </Card>

          <ImageMetaPopover
            meta={request.params}
            zIndex={constants.imageGeneration.drawerZIndex + 1}
            // generationProcess={image.generationProcess ?? undefined} // TODO.generation - determine if we will be returning the image generation process
          >
            <ActionIcon variant="transparent" size="md">
              <IconInfoCircle
                color="white"
                filter="drop-shadow(1px 1px 2px rgb(0 0 0 / 50%)) drop-shadow(0px 5px 15px rgb(0 0 0 / 60%))"
                opacity={0.8}
                strokeWidth={2.5}
                size={26}
              />
            </ActionIcon>
          </ImageMetaPopover>
        </Group>
      )}
    </Paper>
  );
}

type Props = {
  image: Generation.Image;
  selected: boolean;
  onCheckboxClick: (data: { image: any; checked: boolean }) => void;
  onCreateVariantClick: (image: any) => void;
};
