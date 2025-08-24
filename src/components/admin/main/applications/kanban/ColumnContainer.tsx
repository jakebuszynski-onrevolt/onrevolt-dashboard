import { SortableContext, useSortable } from '@dnd-kit/sortable';
import { Column, Id, Task } from 'types/hui-types';
import { CSS } from '@dnd-kit/utilities';
import { useMemo, useState } from 'react';
import TaskCard from './TaskCard';
import Card from 'components/card/Card';
import { IoMdAdd } from 'react-icons/io';
import {
  Flex,
  IconButton,
  Icon,
  useColorModeValue,
  Text,
} from '@chakra-ui/react';

interface Props {
  column: Column;
  deleteColumn: (id: Id) => void;
  updateColumn: (id: Id, title: string) => void;
  createTask: (columnId: Id) => void;
  updateTask: (id: Id, desc: string) => void;
  updateTaskTitle: (id: Id, desc: string) => void;
  deleteTask: (id: Id) => void;
  tasks: Task[];
}

function ColumnContainer({
  column,
  // deleteColumn,
  // updateColumn,
  createTask,
  tasks,
  deleteTask,
  updateTask,
  updateTaskTitle,
}: Props) {
  const [editMode, setEditMode] = useState(false);
  const textColor = useColorModeValue('navy.700', 'white');
  const bgButton = useColorModeValue('secondaryGray.300', 'whiteAlpha.100');
  const brandText = useColorModeValue('brand.500', 'white');

  const tasksIds = useMemo(() => {
    return tasks.map((task) => task.id);
  }, [tasks]);

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: column.id,
    data: {
      type: 'Column',
      column,
    },
    disabled: editMode,
  });

  const style = {
    transition,
    transform: CSS.Transform.toString(transform),
  };

  if (isDragging) {
    return (
      <Card
        ref={setNodeRef}
        style={style}
        h="500px"
        w="100%"
        flexDirection={'column'}
        borderRadius="16px"
        className="flex h-[500px] max-h-[500px] w-full flex-col rounded-md border-2 bg-gray-500 opacity-40 xl:w-[450px]"
      ></Card>
    );
  }

  return (
    <Card
      ref={setNodeRef}
      style={style}
      display="flex"
      w="100%"
      minW={{ base: '85vw', md: 'unset' }}
      flexDirection={'column'}
      maxW="90%"
      borderRadius="16px"
      fontWeight={'700'}
      p="16px"
    >
      {/* Column title */}
      <Flex
        mb="20px"
        justify={'space-between'}
        align="center"
        {...attributes}
        {...listeners}
        onClick={() => {
          setEditMode(true);
        }}
      >
        <Text ml="4px" mt="4px" fontSize="18px" color={textColor}>
          {column.title}
        </Text>
        <IconButton
          w="92px"
          h="35px"
          borderRadius="12px"
          aria-label="Search database"
          variant="no-hover"
          bg={bgButton}
          icon={<Icon w="12px" h="12px" as={IoMdAdd} color={brandText} />}
          onClick={() => {
            createTask(column.id);
          }}
        />
      </Flex>

      {/* Column task container */}
      <Flex maxW="100%" flex="grow" direction="column" gap="20px" p="8px">
        <SortableContext items={tasksIds}>
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              deleteTask={deleteTask}
              updateTask={updateTask}
              updateTaskTitle={updateTaskTitle}
            />
          ))}
        </SortableContext>
      </Flex>
    </Card>
  );
}

export default ColumnContainer;
