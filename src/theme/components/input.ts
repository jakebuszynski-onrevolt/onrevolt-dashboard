import { mode } from '@chakra-ui/theme-tools';

const formValueColor = (props: any) => mode('secondaryGray.900', 'rgba(226, 232, 255, 0.78)')(props);
const formPlaceholderColor = (props: any) => mode('secondaryGray.500', 'rgba(163, 174, 208, 0.52)')(props);

export const inputStyles = {
    components: {
        Input: {
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
                        border: '1px solid',
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
                        fontWeight: '500',
                        color: formValueColor(props),
                        WebkitTextFillColor: formValueColor(props),
                        bg: mode('transparent', 'transparent')(props),
                        border: '1px solid',
                        borderColor: mode(
                            'secondaryGray.100',
                            'rgba(135, 140, 189, 0.3)'
                        )(props),
                        borderRadius: '16px',
                        _placeholder: {
                            color: formPlaceholderColor(props),
                            fontWeight: '400',
                            opacity: 1,
                        },
                    },
                }),
                authSecondary: (props: any) => ({
                    field: {
                        bg: 'transparent',
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
        NumberInput: {
            baseStyle: (props: any) => ({
                field: {
                    color: formValueColor(props),
                    fontWeight: 500,
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
                        bg: 'transparent',
                        border: '1px solid',
                        color: formValueColor(props),
                        WebkitTextFillColor: formValueColor(props),

                        borderColor: 'secondaryGray.100',
                        borderRadius: '16px',
                        _placeholder: { color: formPlaceholderColor(props), fontWeight: 400, opacity: 1 },
                    },
                }),
                auth: (props: any) => ({
                    field: {
                        bg: 'transparent',
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
                        bg: 'transparent',
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
        Select: {
            baseStyle: (props: any) => ({
                field: {
                    color: formValueColor(props),
                    fontWeight: 500,
                    opacity: 1,
                    WebkitTextFillColor: formValueColor(props),
                },
                icon: {
                    color: formValueColor(props),
                },
            }),

            variants: {
                main: (props: any) => ({
                    field: {
                        bg: mode('transparent', 'navy.800')(props),
                        border: '1px solid',
                        color: formValueColor(props),
                        WebkitTextFillColor: formValueColor(props),
                        borderColor: mode(
                            'secondaryGray.100',
                            'whiteAlpha.100'
                        )(props),
                        borderRadius: '16px',
                        fontWeight: 500,
                        _placeholder: { color: formPlaceholderColor(props), fontWeight: 400, opacity: 1 },
                    },
                    icon: {
                        color: formValueColor(props),
                    },
                }),
                mini: (props: any) => ({
                    field: {
                        bg: mode('transparent', 'navy.800')(props),
                        border: '0px solid transparent',
                        fontSize: '0px',
                        p: '10px',
                        _placeholder: { color: 'secondaryGray.600' },
                    },
                    icon: {
                        color: 'secondaryGray.600',
                    },
                }),
                subtle: () => ({
                    box: {
                        width: 'unset',
                    },
                    field: {
                        bg: 'transparent',
                        border: '0px solid',
                        color: 'secondaryGray.600',
                        borderColor: 'transparent',
                        width: 'max-content',
                        _placeholder: { color: 'secondaryGray.600' },
                    },
                    icon: {
                        color: 'secondaryGray.600',
                    },
                }),
                transparent: (props: any) => ({
                    field: {
                        bg: 'transparent',
                        border: '0px solid',
                        width: 'min-content',
                        color: mode(
                            'secondaryGray.600',
                            'secondaryGray.600'
                        )(props),
                        borderColor: 'transparent',
                        padding: '0px',
                        paddingLeft: '8px',
                        paddingRight: '20px',
                        fontWeight: '700',
                        fontSize: '14px',
                        _placeholder: { color: 'secondaryGray.600' },
                    },
                    icon: {
                        transform: 'none !important',
                        position: 'unset !important',
                        width: 'unset',
                        color: 'secondaryGray.600',
                        right: '0px',
                    },
                }),
                auth: () => ({
                    field: {
                        bg: 'transparent',
                        border: '1px solid',

                        borderColor: 'secondaryGray.100',
                        borderRadius: '16px',
                        _placeholder: { color: 'secondaryGray.600' },
                    },
                }),
                authSecondary: (props: any) => ({
                    field: {
                        bg: 'transparent',
                        border: '1px solid',

                        borderColor: 'secondaryGray.100',
                        borderRadius: '16px',
                        _placeholder: { color: 'secondaryGray.600' },
                    },
                }),
                search: (props: any) => ({
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
