import {
  Avatar,
  AvatarGroup,
  Badge,
  Flex,
  Text,
  Textarea,
  Icon,
  Image,
  useColorModeValue,
} from '@chakra-ui/react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useState } from 'react';
import { MdDeleteOutline, MdEdit } from 'react-icons/md';
import { Id, Task } from 'types/hui-types';
import Card from 'components/card/Card';

interface Props {
  task: Task;
  deleteTask: (id: Id) => void;
  updateTask: (id: Id, content: string) => void;
  updateTaskTitle: (id: Id, content: string) => void;
}

function TaskCard({ task, deleteTask, updateTask, updateTaskTitle }: Props) {
  const textColor = useColorModeValue('navy.700', 'white');
  const bgColor = useColorModeValue('white', 'navy.700');
  const textColorSecondary = 'secondaryGray.600';
  // eslint-disable-next-line
  const [mouseIsOver, setMouseIsOver] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editModeTitle, setEditModeTitle] = useState(false);

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: {
      type: 'Task',
      task,
    },
    disabled: editMode,
  });

  const style = {
    transition,
    transform: CSS.Transform.toString(transform),
  };

  const toggleEditMode = () => {
    setEditMode((prev) => !prev);
    setMouseIsOver(false);
  };
  const toggleEditModeTitle = () => {
    setEditModeTitle((prev) => !prev);
    setMouseIsOver(false);
  };

  if (isDragging) {
    return (
      <Flex
        position={'relative'}
        height="100px"
        minH="250px"
        width="full"
        cursor={'grab'}
        align="center"
        borderRadius="10px"
        border="2px solid"
        bg="gray.500"
        p="10px"
        textAlign={'left'}
        opacity="30%"
        ref={setNodeRef}
        style={style}
      />
    );
  }

  if (editMode) {
    return (
      <Card
        bg={bgColor}
        mt="12px"
        display="flex"
        w="470px"
        maxW="100%"
        flexDirection="column"
        borderRadius="16px"
        p="25px"
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onMouseEnter={() => {
          setMouseIsOver(true);
        }}
        onMouseLeave={() => {
          setMouseIsOver(false);
        }}
      >
        <Flex align="center" mb="20px">
          <Text
            fontWeight="700"
            fontSize="lg"
            color={textColor}
            onClick={toggleEditModeTitle}
          >
            {task.title}
          </Text>
          <Flex
            ms="auto"
            cursor="pointer"
            onClick={() => {
              deleteTask(task.id);
            }}
            h="max-content"
            w="max-content"
          >
            <Icon
              color="secondaryGray.500"
              as={MdDeleteOutline}
              w="17px"
              h="17px"
            />
          </Flex>
          <Flex
            ms="6px"
            cursor="pointer"
            onClick={toggleEditModeTitle}
            h="max-content"
            w="max-content"
          >
            <Icon color="secondaryGray.500" as={MdEdit} w="17px" h="17px" />
          </Flex>
        </Flex>{' '}
        {task.image ? (
          <Image
            borderRadius="15px"
            w="420px"
            h="284px"
            src={task.image.src}
            alt=""
            mb="20px"
          />
        ) : null}
        <Textarea
          w="100%"
          resize={'none'}
          borderRadius="16px"
          bg="transparent"
          fontSize="16px"
          color="gray.600"
          _focus={{ outline: 'none' }}
          border="0px solid transparent"
          value={task.desc}
          autoFocus
          placeholder="Task content here"
          onBlur={toggleEditMode}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.shiftKey) {
              toggleEditMode();
            }
          }}
          onChange={(e) => updateTask(task.id, e.target.value)}
        />
        <Flex w="100%" mt="20px" align="center">
          <AvatarGroup size="sm">
            {task.members
              ? task.members.map((member, index) => {
                  let membersNumber = task.members.length;
                  console.log(membersNumber);
                  return <Avatar key={index} src={member.src} />;
                })
              : null}
          </AvatarGroup>
          {task.status ? (
            <Badge
              fontSize="10px"
              fontWeight="bold"
              variant="solid"
              h="28px"
              w="94px"
              ms="auto"
              display="flex"
              borderRadius="8px"
              alignItems="center"
              justifyContent="center"
              bg={
                task.status === 'ERRORS'
                  ? 'red.500'
                  : task.status === 'PENDING'
                  ? 'orange.300'
                  : task.status === 'DONE'
                  ? 'green.500'
                  : task.status === 'UPDATES'
                  ? 'blue.400'
                  : 'teal'
              }
              colorScheme={
                task.status === 'ERRORS'
                  ? 'red'
                  : task.status === 'PENDING'
                  ? 'orange'
                  : task.status === 'DONE'
                  ? 'green'
                  : task.status === 'UPDATES'
                  ? 'blue'
                  : 'teal'
              }
            >
              {task.status}
            </Badge>
          ) : null}
        </Flex>
      </Card>
    );
  }
  if (editModeTitle) {
    return (
      <Card
        bg={bgColor}
        mt="12px"
        display="flex"
        w="470px"
        maxW="100%"
        flexDirection="column"
        borderRadius="16px"
        p="25px"
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onMouseEnter={() => {
          setMouseIsOver(true);
        }}
        onMouseLeave={() => {
          setMouseIsOver(false);
        }}
      >
        <Flex align="center" mb="20px">
          <Textarea
            w="100%"
            resize={'none'}
            borderRadius="16px"
            bg="transparent"
            fontWeight="700"
            fontSize="lg"
            color={textColor}
            _focus={{ outline: 'none' }}
            border="0px solid transparent"
            value={task.title}
            autoFocus
            placeholder="Task content here"
            onBlur={toggleEditModeTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.shiftKey) {
                toggleEditModeTitle();
              }
            }}
            onChange={(e) => updateTaskTitle(task.id, e.target.value)}
          />
          <Flex
            ms="auto"
            cursor="pointer"
            onClick={() => {
              deleteTask(task.id);
            }}
            h="max-content"
            w="max-content"
          >
            <Icon
              color="secondaryGray.500"
              as={MdDeleteOutline}
              w="17px"
              h="17px"
            />
          </Flex>
          <Flex ms="6px" cursor="pointer" h="max-content" w="max-content">
            <Icon color="secondaryGray.500" as={MdEdit} w="17px" h="17px" />
          </Flex>
        </Flex>{' '}
        {task.image ? (
          <Image
            borderRadius="15px"
            w="420px"
            h="284px"
            src={task.image.src}
            mb="20px"
            alt=""
          />
        ) : null}
        <Text fontSize="md" color={textColorSecondary} onClick={toggleEditMode}>
          {task.desc}
        </Text>
        <Flex w="100%" mt="20px" align="center">
          <AvatarGroup size="sm">
            {task.members
              ? task.members.map((member, index) => {
                  let membersNumber = task.members.length;
                  console.log(membersNumber);
                  return <Avatar key={index} src={member.src} />;
                })
              : null}
          </AvatarGroup>
          {task.status ? (
            <Badge
              fontSize="10px"
              fontWeight="bold"
              variant="solid"
              h="28px"
              w="94px"
              ms="auto"
              display="flex"
              borderRadius="8px"
              alignItems="center"
              justifyContent="center"
              bg={
                task.status === 'ERRORS'
                  ? 'red.500'
                  : task.status === 'PENDING'
                  ? 'orange.300'
                  : task.status === 'DONE'
                  ? 'green.500'
                  : task.status === 'UPDATES'
                  ? 'blue.400'
                  : 'teal'
              }
              colorScheme={
                task.status === 'ERRORS'
                  ? 'red'
                  : task.status === 'PENDING'
                  ? 'orange'
                  : task.status === 'DONE'
                  ? 'green'
                  : task.status === 'UPDATES'
                  ? 'blue'
                  : 'teal'
              }
            >
              {task.status}
            </Badge>
          ) : null}
        </Flex>
      </Card>
    );
  }

  return (
    <Card
      bg={bgColor}
      mt="12px"
      display="flex"
      w={{ base: '100%', lg: '470px' }}
      flexDirection="column"
      borderRadius="16px"
      p="25px"
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onMouseEnter={() => {
        setMouseIsOver(true);
      }}
      onMouseLeave={() => {
        setMouseIsOver(false);
      }}
    >
      <Flex align="center" mb="20px">
        <Text
          fontWeight="700"
          fontSize="lg"
          color={textColor}
          onClick={toggleEditModeTitle}
        >
          {task.title}
        </Text>
        <Flex
          ms="auto"
          cursor="pointer"
          onClick={() => {
            deleteTask(task.id);
          }}
          h="max-content"
          w="max-content"
        >
          <Icon
            color="secondaryGray.500"
            as={MdDeleteOutline}
            w="17px"
            h="17px"
          />
        </Flex>
        <Flex ms="6px" cursor="pointer" h="max-content" w="max-content">
          <Icon color="secondaryGray.500" as={MdEdit} w="17px" h="17px" />
        </Flex>
      </Flex>{' '}
      {task.image ? (
        <Image
          borderRadius="15px"
          w="420px"
          h="284px"
          src={task.image.src}
          alt=""
          mb="20px"
        />
      ) : null}
      <Text fontSize="md" color={textColorSecondary} onClick={toggleEditMode}>
        {task.desc}
      </Text>
      <Flex w="100%" mt="20px" align="center">
        <AvatarGroup size="sm">
          {task.members
            ? task.members.map((member, index) => {
                let membersNumber = task.members.length;
                console.log(membersNumber);
                return <Avatar key={index} src={member.src} />;
              })
            : null}
        </AvatarGroup>
        {task.status ? (
          <Badge
            fontSize="10px"
            fontWeight="bold"
            variant="solid"
            h="28px"
            w="94px"
            ms="auto"
            display="flex"
            borderRadius="8px"
            alignItems="center"
            justifyContent="center"
            bg={
              task.status === 'ERRORS'
                ? 'red.500'
                : task.status === 'PENDING'
                ? 'orange.300'
                : task.status === 'DONE'
                ? 'green.500'
                : task.status === 'UPDATES'
                ? 'blue.400'
                : 'teal'
            }
            colorScheme={
              task.status === 'ERRORS'
                ? 'red'
                : task.status === 'PENDING'
                ? 'orange'
                : task.status === 'DONE'
                ? 'green'
                : task.status === 'UPDATES'
                ? 'blue'
                : 'teal'
            }
          >
            {task.status}
          </Badge>
        ) : null}
      </Flex>
    </Card>
  );
}

export default TaskCard;
