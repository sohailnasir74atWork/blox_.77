import { StyleSheet } from "react-native";
import config from "../Helper/Environment";

export const getStyles = (isDarkMode) =>

  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: isDarkMode ? '#121212' : '#f2f2f7',
    },
    loader: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    chatList: {
      flexGrow: 1,
      justifyContent: 'flex-end',
      // paddingHorizontal: 10,
      paddingVertical: 5,
    },
    mymessageBubble: {
      // width: '100%',
      paddingHorizontal: 10,
      borderRadius: 15,
      flexDirection: "row-reverse",
      marginBottom: 10,
      alignItems: 'flex-end'
    },
    othermessageBubble: {
      // width: '100%',
      paddingHorizontal: 10,
      borderRadius: 15,
      flexDirection: 'row',
      marginBottom: 10,
      alignItems: 'flex-start',

    },
    myMessage: {
      alignSelf: 'flex-end',
    },
    otherMessage: {
      alignSelf: 'flex-start',
    },
    senderName: {
      width: 34,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginHorizontal: 5,
    },
    senderNameText: {
      fontSize: 10,
      fontWeight: 'bold',
      color: '#fff',
    },
    messageTextBox: {
      // flex: 1,
      maxWidth:'75%'
    },
    messageTextBoxAdmin: {
      flexDirection: 'column',
      flex: 1,

    },
    myMessageText: {
      fontSize: 12,
      color: isDarkMode ? 'white' : 'black',
      backgroundColor: isDarkMode ? config.colors.primary : 'lightgreen',
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: 10,
      fontFamily: 'Lato-Regular',
      lineHeight:14

    },
    otherMessageText: {
      fontSize: 12,
      color: isDarkMode ? 'white' : 'black',
      backgroundColor: isDarkMode ? config.colors.primary : 'white',
      paddingHorizontal: 10,
      // lineHeight: 20,
      borderRadius: 10,
      paddingVertical: 5,
      fontFamily: 'Lato-Regular',
      paddingRight:20,
      lineHeight:14

    },
    timestamp: {
      fontSize: 8,
      color: '#bbb',
      textAlign: 'right',
      paddingHorizontal: 5
    },
    inputContainer: {
      flexDirection: 'row', // Maintains horizontal alignment with the send button
      alignItems: 'flex-start', // Align items at the top to allow wrapping
      // padding: 10,
      borderTopWidth: 1,
      borderTopColor: '#333',

    },
    input: {
      flex: 1, // Ensures the input takes available space
      borderRadius: 20,
      padding: 10,
      marginRight: 10,
      fontSize: 16,
      heighteight: 30, // Minimum height for a single line
      maxHeight: 120, // Limit input growth to a max height
      textAlignVertical: 'top', // Ensures text starts at the top
      backgroundColor: isDarkMode ? '#333' : '#fff', // Optional background for better visibility
    },

    sendButton: {
      borderRadius: 20,
      // paddingVertical: 10,
      paddingHorizontal: 20,
      // backgroundColor:config.colors.primary
    },
    sendButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: 'bold',
    },
    loggedOutMessage: {
      flex: 1,
      fontSize: 16,
      paddingVertical: 10,
    },
    loggedOutMessageText: {
      color: '#bbb',
      textAlign: 'center',
    },
    dateSeparator: {
      fontSize: 14,
      color: '#888',
      textAlign: 'center',
      marginVertical: 10,
    },
    adminContainer :{
      backgroundColor: config.colors.hasBlockGreen,
      paddingHorizontal:5,
      paddingVertical:1,
      borderRadius:3,
      // marginHorizontal:5
    },
    admin: {
      // alignSelf: 'flex-start',
      color: 'white',
      fontSize: 10,
      fontFamily: 'Lato-Bold',

      
    },
    adminText: {
      fontSize: 12,
      color: 'gray',
      paddingTop: 5
    },
    login: {
      height: 60,
      justifyContent: 'center',
      color: config.colors.hasBlockGreen,
      alignSelf: 'center',
      width: '100%',
      borderTopWidth: 1,
      borderColor: isDarkMode ? '#333333' : '#cccccc',

      //  borderRadius:10

    },
    loginText: {
      color: config.colors.hasBlockGreen,
      fontFamily: 'Lato-Bold',
      textAlign: 'center',
      lineHeight: 24

    },
    inputWrapper: {
      paddingHorizontal: 10,
      paddingVertical:3,
      borderTopWidth: 1,
      borderTopColor: isDarkMode ? '#333' : '#ddd',
      backgroundColor: isDarkMode ? '#222' : '#fff',
      // backgroundColor:'red',

    },
    replyContainer: {
      backgroundColor: isDarkMode ? '#333' : '#f0f0f0',
      padding: 10,
      borderRadius: 8,
      marginBottom: 10,
    },
    replyText: {
      color: isDarkMode ? '#fff' : '#333',
      fontSize: 14,
    },
    cancelReplyButton: {
      alignSelf: 'flex-end',

    },
    cancelReplyText: {
      color: '#E74C3C',
      fontSize: 12,
    },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    // input: {
    //   flex: 1,
    //   backgroundColor: isDarkMode ? '#333' : '#f0f0f0',
    //   borderRadius: 20,
    //   paddingHorizontal: 15,
    //   paddingVertical: 10,
    //   fontSize: 16,
    // },
    sendButton: {
      marginLeft: 10,
      borderRadius: 20,
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    sendButtonText: {
      color: '#fff',
      fontSize: 16,
    },
    replyContainer: {
      backgroundColor: isDarkMode ? '#333' : '#f0f0f0',
      borderLeftWidth: 3,
      borderLeftColor: isDarkMode ? '#1E88E5' : '#007BFF',
      padding: 5,
      marginBottom: 5,
      borderRadius: 5,
    },
    replyText: {
      fontSize: 10,
      color: isDarkMode ? '#1E88E5' : '#007BFF',
      width: '95%'

    },
    replySenderText: {
      fontSize: 12,
      fontFamily: 'Lato-Bold',
      color: isDarkMode ? '#FFF' : '#000',
    },
    profileImage: {
      height: 34,
      width: 34,
      borderRadius: 17,
      backgroundColor:'white'
    },
    profileImagePvtChat: {
      height: 30,
      width: 30,
      borderRadius: 15,
      marginHorizontal: 5,
      backgroundColor:'white'
    },

    userName: {
      color: '#bbb',
      fontSize: 8,

    },
    adminActions: {
      // flexDirection: 'row',
      justifyContent:'center',
      // alignItems:'flex-end',
      // overflow:'hidden',
      // flexWrap:"wrap"
    },
    adminTextAction:{
      backgroundColor:config.colors.wantBlockRed,
      marginHorizontal:3,
      paddingHorizontal:10,
      borderRadius:3,
      color:'white',
      alignSelf:'center',
      width:100
    },
    dot: {
      color: '#bbb',
      marginHorizontal: 5,
      fontSize: 14
    },
    linkText: {
      color: '#1E90FF', // Blue color for links
      textDecorationLine: 'underline', // Underline to indicate a link
    },
 
    menu: {
      borderRadius: 20,
      // backgroundColor:'red'
    },
    menuTrig: {
      borderRadius: 50,
      // backgroundColor: 'red',
      marginBottom: 100

    },
    menuoptions: {
      // flexDirection:'row',
      // justifyContent:'space-evenly',
      maxWidth: 150,
      borderRadius: 10,
      marginLeft:50

    },
    menuOption: {
      paddingHorizontal: 10,
      paddingVertical: 15,
      borderBottomWidth: 1,
      borderColor:'lightgrey',
      backgroundColor:'white',
      borderRadius: 10,

    },
    menuOptionText: {
      fontSize: 16,
      color: '#000',
    },
    reportIcon:{
      position:'absolute',
      right:2,
      top:2,
      opacity:1,
      color:config.colors.wantBlockRed,
      fontSize:8,
      fontStyle:'italic'

    },
    reportedMessage: {
      opacity: .3, // Light blue color
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      // backgroundColor:'red'

    },
    emptyText:{
      color: isDarkMode ? 'white' : 'black',
    }


  });