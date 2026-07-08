import { mode } from '@chakra-ui/theme-tools';

const formValueColor = (props: any) => mode('secondaryGray.900', 'rgba(226, 232, 255, 0.78)')(props);
const formPlaceholderColor = (props: any) => mode('secondaryGray.500', 'rgba(163, 174, 208, 0.52)')(props);

export const textareaStyles = {
    components: {
        Textarea: {
            baseStyle: (props: any) => ({
                field: {
                    color: formValueColor(props),
                    fontWeight: 500,
                    borderRadius: '8px',
                    opacity: 1,
                    WebkitTextFillColor: formValueColor(props),
                    _placeholder: {
                        color: formPlaceholderColor(props),
                        fontWeight: 400,
                        opacity: 1,
                    },
                },
            }),

            variants: {
                main: (props: any) => ({
                    field: {
                        bg: mode('transparent', 'navy.800')(props),
                        border: '1px solid !important',
                        color: formValueColor(props),
                        WebkitTextFillColor: formValueColor(props),
                        borderColor: mode(
                            'secondaryGray.100',
                            'whiteAlpha.100'
                        )(props),
                        borderRadius: '16px',
                        fontSize: 'sm',
                        fontWeight: 500,
                        p: '20px',
                        _placeholder: { color: formPlaceholderColor(props), fontWeight: 400, opacity: 1 },
                    },
                }),
                auth: (props: any) => ({
                    field: {
                        bg: 'white',
                        border: '1px solid',
                        color: formValueColor(props),
                        WebkitTextFillColor: formValueColor(props),
                        borderColor: 'secondaryGray.100',
                        borderRadius: '16px',
                        _placeholder: { color: formPlaceholderColor(props), fontWeight: 400, opacity: 1 },
                    },
                }),
                authSecondary: (props: any) => ({
                    field: {
                        bg: 'white',
                        border: '1px solid',
                        color: formValueColor(props),
                        WebkitTextFillColor: formValueColor(props),

                        borderColor: 'secondaryGray.100',
                        borderRadius: '16px',
                        _placeholder: { color: formPlaceholderColor(props), fontWeight: 400, opacity: 1 },
                    },
                }),
                search: () => ({
                    field: {
                        border: 'none',
                        py: '11px',
                        borderRadius: 'inherit',
                        _placeholder: { color: 'secondaryGray.600' },
                    },
                }),
            },
        },
    },
};
